# L07：上游演进审计与结课迁移

源码精读最大的长期风险不是“没读懂”，而是课程悄悄过期。本课把固定 commit、源码路径、摘要、关键 symbol 和公开 contract 写成 manifest，再比较旧、新两个快照，生成 drift report 与迁移步骤。

## 运行

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/07_upstream_evolution_capstone/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/07_upstream_evolution_capstone/tests/run.ts
```

实验不访问 GitHub。主 fixture 使用课程十二和十三的两个固定 commit，并记录真实 tracked path 与真实 Git blob id：`package.json`、`packages/core/session/src/index.ts`、`packages/acp/acp/src/index.ts`、新增的 `packages/acp/acp/src/content.ts`，以及 node-pty patch 的替换。它们来自本地 `git rev-parse <commit>:<path>`，可以回到 checkout 复核。

fixture 里的 contract 不是 DeepSeek 对稳定 API 的承诺，而是课程为具体消费者声明的依赖：SDK `session/prompt` 仍只返回 `{ messageId }`，ACP 的 `promptCapabilities.image` 从固定 `false` 变为按 attachment service 与模型 route 计算。两者都标为 `experimental`，因此这次真实差异触发 `retest` 和迁移测试，不伪造一个 documented-breaking blocker。测试另用明确标注的合成 fixture 验证“已文档化 contract 改签名必须阻塞”以及 exact move 检测。

## 审计规则

- 相同摘要和 symbols 但路径变化：`moved`，通常只更新阅读锚点；本次选取的真实 delta 没有假造 move，算法能力由合成单测覆盖。
- 同路径摘要或 symbols 变化：`modified`，runtime/session owner 优先视为 breaking。
- documented contract 被删除或改签名：自动升级 gate 必须阻塞。
- 新模块不是天然兼容；它需要 ownership review、测试证据和课程覆盖判断。
- migration plan 先重写 breaking lab，再更新 anchor，最后补 regression test。
- compatibility matrix 按消费者声明的 contract 依赖分别给出 compatible、retest 或 incompatible；不能用一个全局版本号替代逐表面判断。

结课产物不是一句“升级完成”，而是一份可以复核的证据链：before/after commit、Git blob、source drift、consumer contract drift、blocker、迁移步骤和验证记录。

## 本次真实差异

- 根版本从 `0.1.0-rc.5` 变为 `0.1.0-rc.7`。
- `packages/core/session/src/index.ts` 的 blob id 未变，说明这个锚点在两次快照间保持一致。
- `packages/acp/acp/src/index.ts` 被修改，并新增 `content.ts`，引入 rich-content admission、图片能力协商与有序 assistant block 输出。
- `patches/node-pty@1.1.0.patch` 被删除，新增 `patches/node-pty@1.2.0-beta.15.patch`；这是 build/dependency drift，不应被课程误判成 Session runtime breaking change。
