# L06 练习

1. 新增一个 `concurrency: "exclusive"` 工具，记录它前后的 active 数，证明它不会与 safe group 重叠。
2. 把 policy 改成「首次 ask、审批后只允许一次」，并为第二次调用写回归测试。
3. 在 post hook 中返回不可 JSON 化的值，定义明确的 `CANONICALIZE` 错误；确认原始 `tool/call` 仍保留而不会伪造成功 result。
4. 将 `runBatched()` 的输入顺序打乱但保留 `order`，验证 dispatch order 与 commit order 可以不同。
5. 让一个已启动工具在 abort 后尝试写文件，检查 scheduler 是否等待 drain，并用 workspace 重读验证结果。

## 验收

- 正常、拒绝、超时、取消路径中，每个 call id 恰好有一个 result。
- 并发 trace 能区分 dispatch、execute 和 model-order commit。
- 能解释为什么「工具函数返回了值」不等于「这个值已经成为 durable tool/result」。
