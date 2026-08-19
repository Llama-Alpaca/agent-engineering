# L01 练习

1. 让 fixture 在 receipt 前发送两次 `idle`、一个其他 session 的 receipt，证明它们都不能结束 run。
2. 增加孙级 subagent，按 `subagent.started` lineage 动态纳入订阅；未知 child 的 event 必须被过滤。
3. 给 `next()` 加 timeout，分别记录“客户端停止等待”和“服务端 Agent 停止运行”两种事实，禁止用一个 `cancelled` 混淆。
4. 对照 Python SDK snapshot，建立字段级兼容矩阵；任何语言绑定都只能改变命名习惯，不能改变 receipt/idle 归因。
5. 故障注入 shutdown 未响应、stdin EOF 后未退出、SIGTERM 未退出三种情况，检查回收梯子最终 reaps child 且保留 stderr tail。

完成标准：能说明为什么 `messageId` 是 durable enqueue receipt 而不是 prompt-level result，并指出当前 wire 缺少哪些生命周期操作。
