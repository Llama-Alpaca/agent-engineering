# L04：Session 事件溯源——一份日志，多份投影

> 本课问题：为什么对话历史、模型上下文、UI 回放、transcript 不是同一个数组？

这是全课最核心的一节。`packages/core/session` 回答的问题表面上是"怎么存对话"，实际上是"Agent 系统的真相放在哪、怎么让所有消费者各自看到正确的视图"。

## 常规做法会怎么坏：共享 messages 数组的三种崩塌

常规实现是一份可变的 `messages: Message[]`，所有组件对它 push、splice、原地改写。三个场景会先后把它压垮：

1. **上下文太长要压缩。** 常规做法是原地删改数组——但用户已经看过被删掉的原文（UI 回放从此对不上），token 对账再也重放不出"当时的请求"（账目永久失真）。dsh 的回答：压缩是**视图替换**，日志一个字节不动——被 shadow 的原文永远可以从日志找回（精读一/二）。
2. **想 fork 会话、或崩溃后想恢复。** 两者都需要"**当时模型看到了什么**"。可变数组里这个事实已经被后续修改覆盖，无从重建。dsh 的回答：日志 append-only + `deriveMessages()` 纯函数投影，配一个以 THEOREM 命名的测试——"every request rebuilds byte-equal from the session log alone"。
3. **进程在 turn 中间崩了。** 数组留下半个 turn、`tool/call` 没有配对的 `tool/result`——把它重放给 provider 是非法请求，恢复代码只能猜。dsh 的回答：`repair.ts` 在 reload 时确定性补齐（合成 `TOOL_OUTCOME_UNKNOWN`、补 `turn/end {kind:'interrupted'}`），失败分类写进数据。

注意这个设计的执法力度：**"model-visible means logged" 不是文档口号，是每个请求都过一遍的运行时断言**（`invariant.ts`）。上面三种崩塌在 dsh 里不是"靠纪律避免"，是"撞上断言即崩"。

## 阅读地图

1. `packages/core/session/src/types.ts` —— `SessionEventMap`：哪些事实有资格进日志
2. `packages/core/session/src/index.ts` —— `append` 与 `deriveMessages`
3. `packages/core/session/src/surface.ts` —— 模型可见面与 replace 语义
4. `packages/core/agent-loop/src/invariant.ts` —— "model-visible means logged" 的运行时执法
5. `packages/core/session/src/repair.ts` —— 崩溃后的确定性闭合
6. `packages/session/session-persistence-jsonl/src/index.ts` —— 持久化与 resume

## 精读一：一份无损日志，四份投影

进日志的事件（`SessionEventMap`）：`turn/start|end`、`step/start|end`、`user/message`、`assistant/chunk`、`assistant/message`、`tool/call`、`tool/result`、`request/header`……日志是 **append-only** 的，永不原地修改。而四类消费者各自从它投影：

| 消费者 | 投影 | 为什么不能共用一个数组 |
|---|---|---|
| 模型上下文 | `deriveMessages()` 扫 **surface 节点序列** | 必须可被压缩（replace） |
| UI 回放 | append-origin 事件流 | 用户看过的内容**不能被压缩抹掉** |
| token 精确回放 | 原始 `assistant/chunk` 序列 | 回放要 token 级保真 |
| resume/fork | 整份日志重放 | 重建必须无损 |

`surface.ts` 的一段注释把第四行讲透了（原文搜 "deliberately shadows"）：

> The model-visible surface deliberately shadows replaced ranges … a landed replacement would erase conversation the user already saw. Append-origin events are that transcript's durable source material; replacement copies stay model-only.

即：**压缩摘要对模型生效，但用户看过的原文永远可以从日志找回。**

## 精读二：压缩 = 视图替换，不是日志改写

`SurfaceOp = 'append' | { op: 'replace', start, end }`。replace 的提交实现（`surface.ts` 的 `applySurfacePlan`）本质是：在 surface 节点序列上 `splice(start, end-start+1, plan.seq)`，替换节点顶上、被 shadow 的节点从模型视图消失，而 **log 一个字节不动**。写入前有严格校验：replace 区间两端必须是现存 surface 节点；替换节点的 `sourceEventSeqs` 必须**完整覆盖**每个被 shadow 的节点（压缩摘要要能追溯到它概括了哪些原文）；`tool/result` 的 replace 只允许改 content。计划（plan）与提交（commit）两段式：校验失败不可能半改状态。

`deriveMessages()` 的缓存按"代"失效：surface 每发生一次 replace，`replaceGeneration` 递增，整缓存作废重建——增量与一致性的经典平衡。

## 精读三：Model-visible means logged（带执法）

`docs/architecture.md` 的原话："Anything that reaches a model request must be reconstructable from the log, and **a runtime invariant asserts it**." 执法代码在 `packages/core/agent-loop/src/invariant.ts`：一个 prepend 的 `llm/stream` 钩子，对每个请求断言 `JSON.stringify(options.messages) === JSON.stringify(session.deriveMessages())`——不一致即 fail，错误文本搜 "diverges from the dispatch-time durable derivation"。配套测试直接叫 **THEOREM: every request rebuilds byte-equal from the session log alone**（`packages/core/agent-loop/tests/request-reconstruction.spec.ts`）。

为什么这么执着？因为 resume、fork、transcript、审计、token 对账全都建立在这条不变量上。它逼出一个架构结论：**新的模型可见输入必须以新 session 事件的形式出现**——所以 runtime context（时间、环境提示）走 `user/message` 事件而不是内存注入（L08 会再遇到）。

## 精读四：崩溃也要确定性闭合

进程崩溃可能留下没有 `turn/end` 的尾巴。`repair.ts` 的 `interruptedTurnClosers()` 在持久化后端 reload 时补齐：悬空的 `tool/call` 合成 `TOOL_OUTCOME_UNKNOWN` / `TOOL_NOT_STARTED`（两者给模型不同的重试指引）、补 `step/end`、补 `turn/end {kind:'interrupted'}`。注意分工：**live 取消走 L03 的配平路径，`interrupted` 只有持久化 reload 会产生**——loop 自己永不写这个词，两种失败在日志里语义不混。

fork 的边界纪律：`SessionStore.fork` 拒绝在 `OPEN_TURN` 边界分叉，header 记录 `parentSession` 与 `seedLength`——fork 出的会话从平衡前缀重放，保证可重放性。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 读 THEOREM 测试，看它怎么用全新 Session 重建每个请求前缀
grep -n "THEOREM" packages/core/agent-loop/tests/request-reconstruction.spec.ts
# 读 surface replace 的校验
grep -n "sourceEventSeqs\|assertProvenance" packages/core/session/src/surface.ts | head
# 读崩溃修复
grep -n "TOOL_OUTCOME_UNKNOWN\|interrupted" packages/core/session/src/repair.ts | head
```

可选：`pnpm vitest run packages/core/session --reporter=dot`。

## 这样设计买到了什么，付出什么

1. **四个消费者不再互相伤害**——压缩要省 token、回放要保真、UI 不能丢用户看过的内容、恢复要无损。常规做法里这四个需求在同一个可变数组上互相打架；在这里它们是同一份日志的四个纯函数投影，各自的正确性独立成立。
2. **fork/resume/审计/transcript 是"免费"的**——因为它们只是重放日志，没有第二套要同步的状态。课程十三 A01 的 SDK receipt 归因、A02 的投影分层，全都站在这块地基上。
3. **摘要永不脱离出处**——`sourceEventSeqs` 完整覆盖被概括的原文，"压缩摘要幻觉了没发生过的事"可以被机械检查。
4. **不变量有执法者**——THEOREM 测试 + 每请求运行时断言，把"模型看到的东西可重建"从约定升级为崩溃即报的性质。

**代价**：任何新的模型可见输入都必须设计成新的 session 事件（比"往数组塞一条"多一步真正的设计）；replace 的 provenance 校验与两段式提交是实打实的复杂度；append-only 日志只增不减，长期会话的存储与投影性能要靠 L08 的机制在视图层解决，而不是删日志。

## 证据边界

- JSONL 持久化带 write-behind 批写与 `session/flush` 检查点；断电窗口内的丢失边界由该实现决定，本课不展开二进制细节。
- 本课不证明具体压缩策略的质量（L08 对比机制），只证明视图替换的结构。
