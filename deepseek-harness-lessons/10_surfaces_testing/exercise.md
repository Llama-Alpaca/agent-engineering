# L10 练习

## 概念题

1. 为什么比较多个入口时应比较 durable event signature，而不是比较 stdout 字符串？
2. ACP 的 `permission_required`、`denied` 和 `cancelled` 为什么不能折叠成一个 `error`？
3. unit、real-composition、keyless snapshot 和 real-API smoke 各自缺少哪类证据？

## 改码题

1. 增加一个 WebSocket surface，要求它复用 `AgentSpine` 且不改变 durable signature。
2. 给 JSON-RPC 增加 malformed request 分支；协议错误仍要输出合法 JSON，诊断不能进 stdout。
3. 给现有 owner-aware `PluginRegistry` 增加 durable install/dispose audit；注入一个错误 owner 的 dispose，验证目标 owner 的注册不变，另一 owner 的同名注册也不会被删除。

## 失败注入

1. 在构建产物入口故意删掉 `course-capability-stack`，让 mock unit 仍通过，再用 built-artifact smoke 捕获失败。
2. 把一条诊断日志拼到 `protocolStdout`，验证 `protocolStdoutIsPure()` 失败。
3. 让 Python SDK 使用不同 request id，观察 transcript 比较为何失败；再决定应该规范化哪些字段、保留哪些 lineage。

## 设计实验

写一份 CI 证据报告模板，强制把「无 key 的稳定结论」和「有 key 的当天 smoke」分开。报告至少包含 commit SHA、入口构建版本、模型、平台、跳过原因和 snapshot hash。
