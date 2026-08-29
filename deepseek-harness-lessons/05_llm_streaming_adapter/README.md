# L05：LLM 流式适配——Adapter、chunk 与错误即事件

> 本课问题：Agent 循环如何做到不依赖某一家模型 SDK？一条流式输出怎样从不可靠的 chunk 流变成可靠的事实？

`packages/llm/llm` 定义中立词汇与 adapter 缝隙；`packages/llm/llm-deepseek` 是直连 DeepSeek API 的真实 adapter。对比读这两个包是理解"缝隙设计"的最好练习。

## 阅读地图

1. `packages/llm/llm/src/index.ts` —— `LlmAdapter`、`LlmRuntime`、`prepareCall`
2. `packages/llm/llm/src/types.ts` —— 7 种 `StreamChunk` 与顺序契约
3. `packages/llm/llm/src/assembler.ts` —— `BlockAssembler`：唯一的组装算法
4. `packages/llm/llm-deepseek/src/adapter.ts` / `translate.ts` / `sse.ts` —— 真实 provider 侧
5. `packages/llm/llm/src/adapter-failure.ts` / `error.ts` / `retry-policy.ts` —— 错误规范化

## 精读一：Adapter 只有 транспорт 职责

adapter 的全部必选接口是一个方法（`index.ts` 搜 `abstract class LlmAdapter`）：

```ts
abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

DeepSeek adapter 的文档注释自述定位（`adapter.ts` 搜 "transport-only"）：**adapter 只负责传输**——验证、分层、凭证策略全归插件。它的构造参数是三个 thunk（连接选项、API key、用户 id 每请求重新解析），所以"改设置"不需要重启任何东西，而在飞的流保持它起飞时的事实。runtime 侧 `prepareCall` 把 registration、固化配置、retry policy 绑成一次性快照——防止 HMR 把"一个 adapter 的能力结论"与"另一个 adapter 的派发"拼在一起。

chunk 协议（`types.ts`）是 7 种闭联类型：`block-start` / `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end`（携带权威完整块）/ `usage` / `finish`，顺序契约一句话："usage 在 finish 之前，finish 之后什么都没有"。

## 精读二：组装算法只有一份

`BlockAssembler`（`assembler.ts`）是全系统**唯一**的 chunk→message 组装器。读它时注意四个决定：

- `block-end` 到达即冻结该块，之后的同 index delta 直接忽略（注释 "ignore stragglers"）——行为不端的 adapter 无法撑大内存或污染已完成的块；
- 没有显式 `block-start` 的协议（delta-only）按 delta 类型隐式开块；
- `finish` 缺省为正常 stop；
- **唯一的 keep/drop 决策**：`max-tokens` 截断时丢弃全部 tool-call 块——截断的工具调用不安全，不可执行。

因为组装集中在一处，"每个 adapter 自己拼 message"这个错误品类整个不存在。token-meter（L08）重放日志求 usage 用的也是同一个 `BlockAssembler`——实时与重放共享算法，天然对账。

## 精读三：错误是事件，不是异常

async iterable 中途 throw 意味着"已消费的部分输出"与"最终事实"永远无法对齐。所以这个系统的选择是：**adapter 边界内的一切失败被折叠成恰好一个 terminal `finish` chunk**，载荷是冻结的 `LlmFailure`。分流逻辑在 `index.ts` 的 `adapterFailureChunk`：caller 已 abort → `{kind:'aborted'}`，其余 → `{kind:'error', failure}`。边界极其讲究：`yield` 放在 adapter 拥有的 try 之外——**adapter 的失败规范化为事件，消费者/中间件的失败保持异常**。

规范化本身是防御性的（`adapter-failure.ts` 的 `normalizeLlmFailure`）：非 Error 值、跨 realm 副本、带恶意 getter 的对象，全部收敛为稳定事实。错误**分类**集中在一处：各家"上下文超限"的不同措辞由正则识别器统一成唯一 code，外部消费者的纪律是 "route on this, never by parsing `message`"（`error.ts`）。retry 则干脆是**另一个插件**（`dsh-llm-retry`）——adapter 自身零重试，"一次 adapter 调用就是一次 SDK 尝试"。

DeepSeek 侧的诚实细节（`sse.ts` 全文 40 行值得整读）：SSE 流没有 `[DONE]` 就结束 → 直接 `STREAM_CLOSED`（"an unterminated tail at EOF is truncation, not a flushable payload"）；`translate.ts` 把 finish_reason 与 usage 都推迟到 `[DONE]` 统一冲刷，以同时兼容两种 wire 形状；**成功 finish 但零内容块**被翻成错误事件而非空成功（空消息会静默终结 turn）。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 对比两个真实 adapter 怎么落到同一 chunk 协议
ls packages/llm/
grep -n "maxRetries" packages/llm/llm-pi-ai/src/*.ts 2>/dev/null | head -3
# 读组装器的测试：它防的是什么
grep -n "straggler\|max-tokens\|tool-call" packages/llm/llm/tests/assembler.spec.ts | head
# 找错误规范化的敌意输入测试
sed -n '1,40p' packages/llm/llm/tests/adapter-failure.spec.ts
```

## 设计思想

1. **缝隙最小化**：adapter 必须实现的只有一个方法；中立词汇表本身 merge-extensible（插件可加块类型），加 provider 不改核心。
2. **过程与事实分离**：chunk 是过程（可整流写日志做回放），message 是冻结事实（带稳定 id 与出处）；两者由唯一组装器连接。
3. **错误即事件**：恰好一个 terminal finish 携带冻结事实；分类集中、route on code；重试是独立插件的可选层。
4. **一次调用一个自洽世界**：配置代际快照 + 一次性 prepared call，配置变更只影响下一次调用——这是 provider 端 prompt cache 可用的前提。

> 演进注脚：本快照（rc.5）的组装器在 max-tokens 丢块时尚不同步剪裁 replay 元数据；rc.7 引入 `assembled()` 统一决策让两者不可能不一致——课程十三 L07 会把它当作真实演进的案例。

## 证据边界

- 本课证明协议与不变量的结构；两家 adapter（deepseek 直连、pi-ai SDK）是结构中性存在的证据，不构成对任何 provider 质量的判断。
- real-API 行为（超时、限流、计费）随 provider 与时间变化，课程不引用具体数字。
