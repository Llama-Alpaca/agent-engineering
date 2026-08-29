# A04 练习：源码作业

## 1. 阅读题：三重身份校验

`jobs-local` 里 owner fence 实际校验了三件事：owner id 一致、owner 是当前注册实例、准入时 servesOwner。找到三处代码，回答：去掉任何一重分别能构造什么攻击或事故（提示：把 id 换成已 dispose 的 agent？）。

## 2. 追踪题：结算的顺序为什么是这样

把 `settle` 的动作按执行顺序抄下来（判重 → 落账 → 释放 waiter → 标记 → 通知）。对每个"为什么不能提前/延后"写一行理由。如果把"通知"挪到"落账"前，哪个观察者会看到什么幻象？

## 3. 对比题：一张重启矩阵

对照 README 的三行矩阵，在源码里给每个格子找证据：subagent 的 durable 部分（childSessionMeta 哪些字段）、jobs 的易失声明、workflow 各 agent 会话的持久性。写：一个"kill -9 后 30 天"的场景，三者的恢复路径各是什么？

## 4. 思考题：给 jobs 补 durable 层

假设你要实现一个 SQLite 版 `JobRegistry`。回答：(a) 契约里哪些方法签名必须保持？(b) first-wins 在跨进程重启后怎么保证（提示：SQL 的更新条件）？(c) 哪些行为"进程内实现免费但持久化要花钱"（提示：等待中的 waiter）？

## 5. 阅读题：worker 的四道限额

`workflow-worker-thread` 的限额（并发、总数、同步超时、dispose 宽限）各自防什么失控模式？TERMINATE 之后 worker 里的 agent 会话日志怎么样了（提示：durable 在各自的 session log）？

## 6. 设计反思题

你的后台任务系统（celery/RQ/内存 dict/…）对照三纪律自查：owner 校验、first-wins、易失性声明。写一段"最危险的一条缺失 + 一次真实或想象的事故链"。
