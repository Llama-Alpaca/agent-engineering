# L05 练习

1. 增加 `finish: "length"` 路径，并让测试确认它仍会提交文本，但不会自动执行未完成的 tool call。
2. 让 adapter 在 finish 后发送 usage；修改 assembler 使其接受这种合法 trailing chunk，并覆盖回归测试。
3. 编写一个 provider adapter，把另一种原始字段映射成 `StreamChunk`；故意漏掉 `argumentsDelta`，验证错误停在 adapter 边界。
4. 把 retry 改成指数退避的可注入时钟（实验中仍使用零延迟），记录每次 attempt 的 request header。

## 验收

- 每个失败实验都有稳定 `code`，且失败前未调用 `onCommit`。
- 同一 fixture 连续运行两次，chunks 和最终 message 相同。
- 能解释为什么「收到 tool-call chunk」不等于「可以执行工具」。
