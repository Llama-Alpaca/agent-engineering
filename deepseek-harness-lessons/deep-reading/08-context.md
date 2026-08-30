# L08：上下文机制的实现落点——Prompt、压缩、Skill 与 Spill

> 本课问题：课程十一学过的 Harness 机制（压缩、外置、渐进披露、token 对账）在上游分别挂在哪些包、哪些扩展点上？

这是映射课：概念课程十一（本仓 `harness-lessons/`「Agent 执行骨架」）已经讲过"为什么"，本课只回答"在哪、怎么实现、归谁所有"。没读过课程十一也能把本课当独立映射表用——只是每行"为什么需要"那一半要自己补。**注意本课的读法与前几课不同**：不逐文件精读，而是把一张映射表逐行对着源码验证。

## 为什么这些机制全是插件：常驻循环里的上下文黑客会怎样

上下文管理是最容易写进主循环的东西——"发请求前拼个大 prompt、太长了就地裁掉"是常规做法。它坏掉的方式正是前几课的反面教材：

1. **拼 prompt 的捷径撞上执法者。** 在请求组装时从内存塞内容，直接违反 L04 的运行时不变量（model-visible means logged）——dsh 里这不是风格错误，是崩溃。所以"往 prompt 里塞东西"只有一条合法通道：事件。
2. **原地裁剪会丢用户看过的原文**（L04 精读一），所以压缩必须走 surface replace；而 replace 有代数（`replaceGeneration`），两个机制同时改视图时靠重试而不是覆盖解决——循环里手写的裁剪没有这套纪律。
3. **策略写死在循环里 = 换策略要改核心。** dsh 把压缩、瘦身、外置、技能全部做成挂在扩展点上的插件——换一套压缩策略是换插件，`ReactLoopAgent` 对它们一无所知。这是 L01"一切皆插件"在上下文域的兑现，也是这一课要逐行验证的事实。

## 映射总表（先看结论，再逐行进源码）

| 课程十一的概念 | 上游落点 | 挂载点 |
|---|---|---|
| 系统提示分层 | `packages/core/system-prompt`（`class SystemPrompt extends Service`） | section/context 注册表，每 step 组装 |
| 运行时上下文（时间、环境） | `packages/core/agent-loop/src/runtime-context.ts`（`RuntimeContextProjection`） | 投影成 `user/message` 事件入日志 |
| 压缩（摘要替换） | `packages/compaction/compaction-basic` | L04 的 surface replace |
| 工具结果瘦身 | `packages/compaction/compaction-tool-result-pruner`（`class ToolResultPruner extends Service`，`ctx.toolResultPruner`） | model-free 剪枝 |
| 长结果外置 | `packages/spill/spill`（+ `spill-local`、`spill-policy`） | 只改 durable/model copy 允许的视图 |
| 技能渐进披露 | `packages/skill/skill-filesystem`（`ctx.skills`） | 文件系统 + agent scope 加载 |
| token 对账 | `packages/llm/token-meter` | 用 `BlockAssembler` 重放日志求 usage |

## 逐行精读要点

**1. System prompt 是注册表不是字符串。** `ctx.systemPrompt` 收 sections（persona、runtime context、技能说明）与 tool schemas，每个 step 现场组装。这意味着"改提示词"永远是"改某个插件的注册"，不存在一个藏满魔法的巨型 prompt 文件。

**2. 运行时上下文必须走日志。** 回忆 L04 的不变量：model-visible means logged。所以时间、环境提示这类"每个请求都想注入"的上下文，实现为 `RuntimeContextProjection`——投影成 `user/message` 事件进入日志，而不是在请求组装时从内存塞进去。想清楚这条再读代码：**"往 prompt 里塞东西"这个动作在上游被结构性地禁止走内存捷径**。

**3. 压缩 = surface replace + 竞态重试。** `compaction-basic` 用 L04 的 replace 语义做摘要替换。读它的调度代码时注意一个细节（在快照里搜 `replaceGeneration`）：压缩计划基于某个 surface 代数生成，落盘前如果代数变了（别的机制先改了视图），它会**重试**而不是覆盖——"retrying from the replacement surface"。

**4. 工具结果瘦身是独立服务。** `ctx.toolResultPruner` 是 model-free（不需要模型调用）的剪枝器：把巨大的工具结果在 durable copy 与 model view 之间做差。它和 compaction 是两个机制：一个处理"单条结果太大"，一个处理"整段历史太长"。

**5. Spill 只改允许改的视图。** spill 把超长内容外置到文件、在原位留引用。关键不变量：canonical value 不动（L06 的输出契约），只有 durable/model copy 里**允许改写的那份**被替换——回放与审计仍然拿得到原文。

**6. Skill 是文件系统 + 作用域。** `skill-filesystem` 把技能目录暴露给模型；技能在 agent scope 里加载（L07），全局目录不会无条件进入每个 agent——这正是课程十一"渐进披露"的实现形态。

**7. Token 对账靠重放。** `token-meter` 直接 `new BlockAssembler()` 从日志重放 chunk 求 usage（缺失时退化为启发式估计）。实时计量与事后对账用**同一个组装器**（L05 的红利）：账目分歧这个 bug 品类不存在。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 验证映射表每一行真的存在
grep -n "class SystemPrompt" packages/core/system-prompt/src/index.ts
grep -n "class ToolResultPruner" packages/compaction/compaction-tool-result-pruner/src/index.ts
grep -n "replaceGeneration" packages/compaction/compaction-basic/src/index.ts | head -3
grep -n "new BlockAssembler" packages/llm/token-meter/src/index.ts
# 读 runtime context 怎么变成 user/message
grep -n "user/message\|RuntimeContextProjection" packages/core/agent-loop/src/runtime-context.ts | head
```

## 这样设计买到了什么，付出什么

1. **上下文策略是可替换的，不是 baked-in 的。** 换压缩算法、换瘦身规则、换技能目录结构，都是换/叠插件——核心循环的代码路径为零变化。课程十一讲过的"收益矩阵"可以在同一骨架上做公平对比。
2. **模型可见的注入只有一条合法通道**：事件。任何"直接改请求"的捷径都会撞上 L04 的运行时不变量——这条纪律保证了无论多少上下文机制叠加，THEOREM 依然成立。
3. **视图可以被多种机制改写，但改写要带代数与出处**：replaceGeneration 防竞态覆盖，sourceEventSeqs 保可追溯——多机制共存不靠"小心"，靠校验。
4. **对账用同一算法**：实时与重放共享组装器，token 账目天然一致。

**代价**：每个上下文机制都要按插件形态设计（注册、事件、可卸载），比在循环里写一个 if 难；所有模型可见的变更都要付出"设计成事件"的成本——这正是它们能共存且不破坏可重放性的价格。

## 证据边界

- 本课不重新论证"为什么需要压缩/外置"（课程十一的任务），只验证实现与所有权。
- 各机制的收益数字（省多少 token、保留多少关键事实）是环境相关证据；本仓不做新的收益矩阵，课程十一已有。
