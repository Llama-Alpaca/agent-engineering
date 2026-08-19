# L04 练习

1. 让 producer `cancel()` 抛错，证明状态仍是 running；再让 cancel 成功但 `done` 延迟，证明 stopping 继续占容量。
2. 用相同 session id 的 replacement Agent 读取旧 job，再尝试用另一个 session 读取。解释 start ownership 与 read authorization 为什么不是同一判据。
3. 连续完成三个会自我唤醒的 job，把 `maxConsecutiveWakes` 设为 2，确认第三个只 quiet delivery；在用户产生新活动后重置预算。
4. 在 workflow 中测试普通 child error、fatal `WorkflowError`、取消前 `go`、等待 child 时取消、worker death；每次核对 start/end 恰好成对。
5. 设计真正 durable provider：列出 journal、lease、checkpoint、幂等副作用键和重启认领协议。把它作为新 provider，不要把能力写进 `jobs-local` 的事实说明。

完成标准：能明确回答“当前什么会跨 Agent step 存活、什么会跨进程重启存活”，并用测试证明两者不是同一个承诺。
