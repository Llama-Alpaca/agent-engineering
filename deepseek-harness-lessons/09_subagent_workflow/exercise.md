# L09 练习

## 概念题

1. fresh、fork、continuation 三者分别复制了什么状态？哪一种最容易意外把父级秘密带入 child？
2. 为什么 parent projection 不应直接 replay child 的全部消息？请从权限、UI 和恢复三个角度回答。
3. 「cancelled」和「disposed」是同一个终态吗？用本课的字段说明差异。

## 改码题

1. 给 `ChildReport` 加上 `startedAt`、`finishedAt` 和 `durationMs`，要求测试仍保持 deterministic。
2. 将 `runWorkflow()` 改为接收失败重试策略：最多一次 retry，并在 parent log 中记录 attempt lineage。
3. 为 fork 增加 `redactPrefix()`，证明被复制的前缀经过脱敏后不会影响 parent 的 canonical log。

## 失败注入

1. 让 `cancelParent()` 只设置 parent 标志而不调用 `cancelChild()`，写测试捕获遗留 running child。
2. 把失败分支改成 `status="succeeded", summary=""`，验证为什么这会破坏 durable replay。
3. 在 dispose 后允许 `followUp()`，为该路径补一个 fail-closed 断言。

## 设计实验

设计一个真实 worker-thread workflow 的消息协议：worker 崩溃、parent 重启和重复 report 时如何保持幂等？列出需要落盘的最小事件集合，并说明本课的内存 `SessionLog` 尚未覆盖哪些故障。
