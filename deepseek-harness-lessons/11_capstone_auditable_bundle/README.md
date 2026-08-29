# L11：毕业课——读通之后做一次真实的扩展

> 本课问题：不修改 `packages/core/` 的任何一行，给一个运行中的 dsh 加一点新能力，并用上游自己的验证体系证明它工作、可拆卸、可审计。

前 11 课读完了整条链路。毕业课把"读"变成"改"——**在检出的快照里**完成一次最小但真实的扩展。旧版毕业课在本仓里搭一个假想 Bundle；重新定义后的毕业课在真实源码上动手，因为这门课教你的是 DeepSeek Harness，不是课程自造的平行宇宙。

## 阅读地图（先读，再动手）

1. `docs/architecture.md` 的 "Where new behavior goes" 表 —— 选型依据
2. `docs/cookbook/adding-a-package.md` —— 新包的骨架与 `dsh` 字段
3. `docs/cookbook/adding-a-tool.md` —— 走 `ctx.tools` 的完整路径
4. `docs/cookbook/adding-an-llm-adapter.md` —— adapter 路径（选做方向）
5. `examples/headless-agent/` —— 最小可组合示例，当模板抄

## 毕业项目（三选一）

在快照的 `examples/` 下新建一个包（**不改 `packages/core/*`**），按 cookbook 组装：

**方向 A：一个 human command**（难度低）——注册到 `ctx.commands`，不经过模型 turn 就能执行（例如打印当前 session 的 token 对账，数据来自 L08 的 token-meter 思路）。

**方向 B：一个观察者插件**（难度低）——监听 `session/event`，维护"本会话工具调用统计"（次数、失败率、最大结果），并注册一个 human command 展示。验证 durable 语义：resume 后统计仍在（把统计写进你自己的 storage seam 或从日志重放）。

**方向 C：一个最简工具**（难度中）——`defineTool` 定义一个只读工具（例如 `repo_stat`：读 git 状态返回结构化 JSON），走完 L06 的输出契约（value schema + render 分离）、声明 `isConcurrencySafe`，被 guard 之外的策略管线放行。

### 通用验收（三个方向相同）

1. **挂载走组合**：用 `--patch` overlay 或最小 profile 挂载你的包，不修改 `dsh-base`（L02 的纪律）。
2. **真实入口验证**：`pnpm install && pnpm run build` 后，从 headless 或示例入口真实启动一次，观察你的扩展生效（方向 B 还要验证 resume）。
3. **可拆卸**：卸载/去掉 patch 后，注册归零、无事件监听器残留（L01 的 HMR-safety；给插件写一个"装卸 10 次注册数回到基线"的测试）。
4. **不破坏核心**：`git diff --stat packages/core` 为空。
5. **写半页设计说明**，回答每课 README 结尾的五个老问题：它拥有什么状态？通过 Service/event/session event 与谁交互？卸载/取消/恢复时谁收尾？哪条证据证明它工作、哪条不能？哪些结论是通用原理、哪些只属于本快照？

### 测试证据（至少三选二）

- 给自己的包写 unit 测试（vitest，参照上游任意 `tests/*.spec.ts` 的风格）；
- 一个装卸回归测试（HMR-safety）；
- 一次 keyless 真实组合运行（headless 或 example 入口）+ 输出粘贴进设计说明。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 模板：最小示例怎么组装
cat examples/headless-agent/package.json
# cookbook 的步骤清单
sed -n '1,60p' docs/cookbook/adding-a-tool.md
# 出口检查表：你的扩展落在哪一行
grep -n "Where new behavior goes" -A 20 docs/architecture.md
```

## 全课收束：十条可迁移的设计思想

毕业时你应该能对每条给出本课的源码证据：

1. 注册即效应，卸载自动回卷（L01）
2. 配置即架构：整行替换换来源可解释（L02）
3. 数据决定，不是监听顺序决定（L03）
4. 单一 append-only 真相 + 按受众投影（L04）
5. 不变量要有运行时执法者（L04）
6. 错误即事件；分类集中、route on code（L05）
7. 不可翻转的拒绝单独成类（单调 guard）（L06）
8. 缝隙三角色齐备才算能力；能力事实要诚实（L07）
9. 授权而非保密；易失性要声明（L09）
10. Receipt, not result；归因走持久日志（L10）

## 证据边界

- 毕业项目在**可丢弃 checkout** 里进行；`pnpm install` 会装 worktree-local hooks（对照快照 CONTRIBUTING 的说明），不要在本仓或你的项目仓库里做。
- 真实 API 冒烟（给方向 C 的工具接真模型）是可选加分项，结论带环境与日期，不作为通用承诺。
