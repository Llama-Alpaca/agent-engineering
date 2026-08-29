# L06：Tool Runtime——契约、管线与并发纪律

> 本课问题：一个工具调用从 model schema 到 durable result 要经过哪些关卡？为什么并发执行不破坏模型看到的顺序？

工具不是 `call(function)`。`packages/core/tools` 的 `ToolRuntime` 把一次调用拆成一条流水线，每个阶段都有明确的可变权限；`agent-loop/tool-calls.ts` 负责调度与提交。`docs/tool-execution-pipeline.md` 的 mermaid 图是本课的地图。

## 阅读地图

1. `packages/core/tools/src/schema.ts` —— `defineTool`：作者 DSL 与输出契约
2. `packages/core/tools/src/index.ts` —— 管线五阶段（本课主菜，约 2000 行，按阶段分段读）
3. `packages/core/agent-loop/src/tool-calls.ts` —— 并发调度与有序提交
4. `packages/core/tools/src/invariant.ts` —— 伴生不变量插件
5. `docs/tool-execution-pipeline.md` —— 官方管线图，读完自检

## 精读一：输出契约——value 与 render 分离

`defineTool` 强制每个工具声明 `output: { schema, render }`：`execute` 只能返回符合 schema 的 lossless JSON `value`（durable、可替换、可重验）；`render` 是纯函数把 value 投影成模型可见的 `ContentBlock[]`。一个 value 多种受众（模型/程序/UI 回放），每种投影可独立替换且无损。注意软硬验证的区分：`execute` 前参数硬校验（失败抛错），而 presentation 类函数软校验——它们可能在**回放任意历史参数**时运行，"must never throw"。

模型看到的 schema 是白名单投影：`schemas()` 只发 `name/description/parameters`，超时、并发标记、presenter 全部 "must never reach the model"（`packages/core/tools/tests/tools.spec.ts` 有专门断言）。

## 精读二：五阶段管线

`ToolRuntime.execute` 内部是 staged 接口（prepare / dispatch / finalize / finish），每段之间由 registry 拥有的归一化边界连接：

| 阶段 | 内容 | 谁能改什么 |
|---|---|---|
| `createExecution` | 参数物化深冻结、铸造 opaque token、快照 `finalizeContent` | 无人 |
| `prepare` | `tools/pre-execute` waterfall → approval `ask` → **单调 guard** | listener 可 allow/deny/ask 或改参 |
| `dispatch` | `tools/execute` waterfall 包裹 body；结果**重新过输出契约** | wrapper 只能换 signal 与结果 |
| `finalize` | `tools/post-execute`：`accept(content/value)` 或 `block(feedback)` | 可替换或阻塞结果 |
| `finish` | 物化 → 同步 `finalizeContent` → 冻结 → `tools/result` | 无人 |

三个读源码时必须注意的细节：

- **单调 guard**：`ToolGuard` 返回 `string | undefined`——**没有 allow 返回值**。类型注释原文："Because guards have no allow result, listener ordering cannot turn a denial back into permission." 可扩展的策略（waterfall）与不可让步的拒绝（guard）在类型上分开。
- **拒绝先于策略**：code-collapse 产生的确定性拒绝在策略管线**之前**终止（注释搜 "observe — or worse, approve — a call that can only fail"）——审批和 guard 永远不应该观察、更不应该批准一个注定失败的调用。
- **wrapper 不能切断取消**：`tools/execute` 的 wrapper 可以替换 signal，但 registry 在 body 前用 `fuseToolSignals` 重新熔合 caller 的原始信号；wrapper 伪造的结果经 `normalizeDispatchResult` 用 token 对账后**重新过一遍输出契约**。

## 精读三：并发解耦于提交序

`tool-calls.ts` 的调度规则：

- 每个调用启动前重新读 `executionMode`（`isConcurrencySafe` 缺失/抛错/非精确 true 一律 **exclusive**——fail-closed 分类）；排他调用单独成组形成 barrier；
- **dispatch 可以并发，提交必须有序**：`commitReady` 只沿连续的 model-order slot 前进——后完成的调用先 settle 也不能提交，必须等前面的槽位就位（测试用例名："commits tool/result in model order even when a later call settles first"）；
- 取消时：已启动的 body **drain 到静默**（"Cancellation never abandons the body"），未启动的补 `appendSkippedToolCall` 合成结果；调度器自身故障则排空已启动调用并抛出，"without fabricating results"——故障与取消在日志里是不同的词。

伴生插件 `tools/src/invariant.ts` 用 `internal/dispatch` 钩子验证阶段顺序本身：pre-execute 不得重复、execute 必须跟在 pre 后、`tools/result` 前 exec 与 result 必须已冻结。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 读三个经典调度测试的断言
grep -n "forms a barrier\|model order\|stops replenishing" packages/core/agent-loop/tests/tool-calls.spec.ts
# 找到 guard 的类型定义与注释
grep -n "no allow result" packages/core/tools/src/index.ts
# 验证 schema 白名单投影
grep -n "never reach the model" packages/core/tools/tests/tools.spec.ts
```

可选：`pnpm vitest run packages/core/tools packages/core/agent-loop/tests/tool-calls.spec.ts --reporter=dot`。

## 设计思想

1. **waterfall 而非 hook 数组**：每个阶段是可否决的有序链，阶段间由 registry 的归一化边界强制重入不变量——任何一方都绕不过输出契约重验与最终冻结。
2. **不可翻转的拒绝单独成类**：guard 无 allow 返回值，"listener 顺序翻转权限"这个 bug 品类在类型层面消失。
3. **value/render 分离**：durable 的是结构化 value；模型、程序、UI 各自投影；post-execute 的替换必须同时重算两种投影。
4. **并发是吞吐问题，有序是语义问题**：两者分开解决——执行重叠、提交按模型序；取消 drain 不放弃、故障不伪造。

## 证据边界

- 本课证明管线结构与调度不变量；具体工具（bash/fs/web…）的能力与安全语义属 L07。
- Code Mode 子调用走同一管线的证据在 `tools/src/code-mode.ts`，本课只给结论。
