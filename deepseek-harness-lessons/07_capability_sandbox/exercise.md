# L07 练习

1. 增加第三个 realm，使用不同 root 和 Evidence Provider；证明它读取同名路径时不能看到另外两个 realm 的文件。
2. 给 `EvidenceReader` 增加结构化 metadata，但只修改 Definition 和 Provider；Consumer 的调用路径保持不变。
3. 新增一次性 shell approval，只允许精确命令 `git status`；命令参数变化必须重新 ask 或 deny。
4. 制造一个 Provider 返回错误类型的负例，验证 Definition 的 `validate()` 在 Consumer 运行前失败。
5. dispose realm 后检查 world、FS、shell、evidence 四项能力都不可再 resolve，并保留 durable audit。

## 验收

- 替换 Provider 时 Consumer 和 Agent loop 零改动。
- 越界读写、未审批写入和危险 shell 都 fail closed。
- `approveOnce` 不能被第二次操作或不同 target 重用。
- 能明确区分 policy test 与 native sandbox test 的证据强度。
