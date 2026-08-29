# A02 练习：源码作业

## 1. 追踪题：一个投影值的旅程

以 `title` 为例，从 host 计算（session-title 包）到客户端 `SessionSummary.title`，列出它经过的每一站（日志事件 / projection 帧 / store 结算 / 读取 API）。回答：`displayTitle` 的回退链是什么？为什么要区分"实际标题"与"展示标题"？

## 2. 阅读题：stale baseline 防护

读 `packages/client/runtime/tests/projection-store.client.spec.ts` 里 higher-seq-wins 相关用例。回答：什么是 baseline？订阅建立时携带的 baseline 怎么防止"重放的旧快照覆盖新帧"？构造一个没有 baseline 的反例场景。

## 3. 对比题：rename 的两条更新路径

`ISession.rename` 从 unary 响应直接结算 title 格，之后推送帧又带同一 seq。回答：为什么这不是双写冲突？如果 unary 响应不带 seq，这个设计还成立吗？

## 4. 思考题：为什么客户端不自己算投影

假设 Python SDK 也想本地算 todos 投影（避免等 host）。列出这会引入的三个新问题（提示：两语言算法漂移、日志格式耦合、投影注册表同步）。对照 A01 的"双客户端十字检查"讨论。

## 5. 实验题：数一数投影类型

在快照里 `grep -rn "SessionProjectionMap\|declare module" packages/session/session-projection/src/ --include="*.ts" | head`，再找两个实际注册投影的包（提示：todos、title）。每个注册声明了什么（键、输入事件、产出）？

## 6. 设计反思题

你的前端/客户端状态管理里，"服务器算好的现状"与"本地即时视图"怎么合并？有没有出现过旧数据覆盖新数据的 bug？写一段用 higher-seq-wins 重构的思路。
