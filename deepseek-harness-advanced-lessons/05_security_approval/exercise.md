# L05 练习

1. 在 open turn 外发起审批，验证日志零变化；在 turn 内让 answerer 抛错，验证仍产生配对的 `asked/decided(unavailable)`。
2. 让 answerer 迟到返回 `allowed-once`，signal 先 abort，证明最终 outcome 是 `cancelled` 且迟到 grant 无效。
3. 切换 permission preset 后重放 session log，仅靠三个 durable event 恢复当前 preset；再手工改一个 knob，确认派生值变为 `custom`。
4. 为 Linux、macOS、Windows 分别写证据卡：runner、probe、enforcement、拒绝方言和已知限制。没有环境实跑时必须标 `not-run`。
5. 将“签名 approval token 绑定完整参数”作为额外加固方案设计，但标明它不是当前 `rc.7` 的 wire/service contract。

完成标准：所有拒绝路径都 fail closed、每个问题都有且只有一个决定；报告中不会用 policy event 或 mock 测试冒充原生隔离证据。
