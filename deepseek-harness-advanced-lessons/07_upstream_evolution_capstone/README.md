# A07：毕业课——三个快照之间的真实演进

> 决策案例：一门锁快照的源码课怎么面对"上游在跑"？答案是把演进本身变成教材：沿 `47f9438 (rc.5) → 99f6f02 (rc.7) → b150a551 (master, 0.1.1-rc.2)` 三个真实快照，验证前面七课讲的决策哪些被时间加固、哪些被改写、哪些长出了新模块。

## 三个快照的坐标

| 快照 | 角色 | 距上一站 |
|---|---|---|
| `47f9438`（rc.5） | 课程十二的基线 | — |
| `99f6f02`（rc.7） | 本课程基线 | 111 commits |
| `b150a551`（master / 0.1.1-rc.2） | 演进观察点（2026-08-27 观察） | 743 commits |

## 已核实的演进事实（毕业课的出发点）

**rc.5 → rc.7（111 commits）：核心冻结，边缘生长。** 核心 six 文件（`agent.ts`、`inbox.ts`、`session/index.ts`、`tools/index.ts`、`profile.ts`、`fiber.ts`）几乎逐字节未动；变化集中在：

- **ACP admission 长成独立模块**：`content.ts` 从 `index.ts` 里拆出来，测试也拆成 turns/content/dispose/edges 四份——A00 讲的两遍式事务是拆分的产物；
- **`settlePrompt` → `settleAfterQuiescence`**：改名伴随三道门语义的显式化（A00）；
- **组装器新增 `assembled()`**：max-tokens 的 keep/drop 决策与 replay 元数据剪裁统一到一处——"Emitted blocks and replay metadata both derive from this result, so they cannot disagree"（课程十二 L05 的演进注脚）。

**rc.7 → master（743 commits）：决策存活，基础设施生长。** 抽查核心决策的锚点全部存活："never queues a late user message"、"Exactly one per ask"、"records die with the harness process"、"do not ration real-API tests" 原文仍在。生长的是外围：`.github/workflows/` 从 6 个长到 18 个（新增 landlock-run、e2b-e2e、pi-ai-provider-e2e、sandbox 等平台 lane）；jobs/preset 的 diff 只有版本号级别的小改。

**这个模式本身就是结论**：好决策的表现不是"永远不变"，而是**核心不变量稳定、外围按压力方向生长**——事件溯源的配平纪律不需要改，平台验证的 lane 需要一直加。

## 毕业项目：亲手做一次 drift 审计

在你的 checkout 里完成：

```bash
repo="$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
cd "$repo"

# 1. 复现 rc.5 锚点的断裂：把工作树切到 rc.5，跑课程十二的锚点校验器
git checkout --detach 47f9438
DSH_SOURCE_DIR="$repo" node --experimental-strip-types \
  /path/to/awesome-agent-engineering/deepseek-harness-lessons/10_surfaces_testing/code.ts
# 预期：settlePrompt 锚点 OK；再切到 99f6f02 重跑，同一锚点 BROKEN——这就是漂移检测

# 2. 反向：本课程的锚点对 master 的存活率
git checkout --detach b150a551
for lesson in 00 01 02 03 04 05 06; do
  DSH_SOURCE_DIR="$repo" node --experimental-strip-types \
    /path/to/awesome-agent-engineering/deepseek-harness-advanced-lessons/${lesson}_*/code.ts
done

# 3. 找三个"课程没讲但 master 长出来"的东西
git diff --stat 99f6f02 b150a551 -- packages/ | sort -t'|' -k2 -rn | head -20
```

## 交付物

写一份**迁移报告**（存进本课目录 `migration-notes.md`）：

1. **存活清单**：七课的锚点哪些在 master 全绿（引用校验器输出）；
2. **断裂清单**：哪些锚点在 master 变红，逐条归因（改名？搬家？语义变化？）；
3. **消费者兼容矩阵**：按 A01/A02 的视角评估——一个依赖 receipt 协议的 SDK 客户端、一个自定义 preset、一个 jobs 消费者，各自跨 rc.7→master 要改什么；
4. **课程修正建议**：本课程哪些结论应该改写、哪些只是快照事实过期（对照三层事实纪律）；
5. **升级门槛建议**：如果课程要换锁到 master，按"先跑兼容矩阵、再决定"的流程列出必须全绿的检查点清单。

## 设计思想（全课收束）

1. **锁快照与追演进不矛盾**：锚点校验器让"过期"从错觉变成信号——课程对每个 SHA 负责，切换是显式决定。
2. **演进方向是决策质量的证据**：核心不变量冻结 + 外围按压力生长，说明分层切对了。
3. **改名与拆模块是演进的主要形态**：语义漂移远比人们担心的少，符号漂移远比人们预期的多——所以锚点校验值得自动化。
4. **消费者视角评估升级**：不是"上游变了什么"，而是"每类消费者要改什么"。

## 证据边界

- master 侧观察基于 2026-08-27 的 `b150a551`；它还在跑。
- 毕业项目在可丢弃 checkout 里做；迁移报告的结论带 SHA 与日期，不外推到未来版本。
