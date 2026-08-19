# L07 练习

1. 在两个真实 checkout 上重新执行 `git rev-parse HEAD` 与 `git rev-parse <commit>:<path>`，证明主 fixture 的 commit 和 blob id 可复核；不存在的 path 必须显式记录为 added/removed。
2. 增加 rename + modify 的相似度检测，但要求低置信度结果只能标记 `manual-review`。
3. 将每个课程 lesson 映射到 source anchors；一个 breaking anchor 改动时，自动列出受影响 lesson。
4. 为 migration gate 增加“所有 regression test 已通过”证据，禁止只改 manifest 就解除 blocker；同时区分上游 documented contract 与插件自己声明的 experimental consumer dependency。

完成标准：能从上游变更回答“哪些课仍可信、哪些课需改写、证据是什么”，而不是仅比较版本号。
