# L03 练习：源码作业

## 1. 默写题：turn 的完整事件序列

合上一切材料，凭 `docs/agent-lifecycle.md` + 你读过的 `agent.ts`，从 `followup()` 开始默写 durable 事件序列直到 `turn/end`（含一次工具调用、一次追问触发的第二个 turn）。然后对照文档逐个检查，标出你漏掉的第一个事件并解释它为什么存在。

## 2. 追踪题：steer 的两条路径

在 `agent.ts` 里分别追踪 `steer()` 在 **driver 运行中**与 **driver idle** 时的完整路径。回答：两种情况下这条输入分别何时被 claim？为什么 `inject()` 永远不唤醒 driver，而 idle 时的 inject 会一直躺在队列里？

## 3. 追踪题：取消的三处配平

取消可能发生在 (a) pre-step 之前、(b) 流式输出中途、(c) 工具已调度未完成。对每种情况在源码里找到证据，回答：`step/start` 落了没有？`tool/call` 落了的话 `tool/result` 从哪来？最后读 `packages/core/agent-loop/tests/cancel.spec.ts` 里含 "balances replay" 的用例，引用它的断言。

## 4. 阅读题：为什么 turn 先开再 claim

`turn()` 先 `append('turn/start')` 再 claim inbox。读 `packages/core/agent/src/consumed-work.ts`（或同目录对账逻辑），解释：如果反过来（先 claim 再开 turn），重启恢复时会丢掉什么信息？

## 5. 实验题：改一行源码观察配平

在检出的快照里（** disposable checkout，可随时 `git checkout .` 还原**）把 `agent.ts` 里落 `step/end` 的 `finally` 改成普通顺序执行，然后跑 `pnpm vitest run packages/core/agent-loop/tests/cancel.spec.ts`（需 install）。观察哪条测试变红、红的原因里出现了什么不变量语言。还原改动。

## 6. 设计反思题

假设你要给循环加"每 turn 最多 N 步"的预算：

- 用本课学过的机制，最少代码的挂法是什么（提示：`agent/pre-step` 能 reject；`ToolExecutionResult.concludesTurn` 是数据）？
- 为什么不推荐直接改 `ReactLoopAgent`？
