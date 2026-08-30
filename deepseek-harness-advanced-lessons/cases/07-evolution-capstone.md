# A07：毕业课——三个快照之间的真实演进

> 决策案例：一门锁快照的源码课怎么面对"上游在跑"？答案是把演进本身变成教材：沿 `47f9438 (rc.5) → 99f6f02 (rc.7) → b150a551 (master, 0.1.1-rc.2)` 三个真实快照，验证前面七课讲的决策哪些被时间加固、哪些被改写、哪些长出了新模块。

## 三个快照的坐标

| 快照 | 角色 | 距上一站 |
|---|---|---|
| `47f9438`（rc.5） | 课程十二的基线 | — |
| `99f6f02`（rc.7） | 本课程基线 | 111 commits |
| `b150a551`（master / 0.1.1-rc.2，完整 SHA `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`） | 演进观察点（2026-08-27 观察） | 743 commits |

## 已核实的演进事实（毕业课的出发点）

**rc.5 → rc.7（111 commits）：核心冻结，边缘生长。** 核心 six 文件（`agent.ts`、`inbox.ts`、`session/index.ts`、`tools/index.ts`、`profile.ts`、`fiber.ts`）几乎逐字节未动；变化集中在：

- **ACP admission 长成独立模块**：`content.ts` 从 `index.ts` 里拆出来，测试也拆成 turns/content/dispose/edges 四份——A00 讲的两遍式事务是拆分的产物；
- **`settlePrompt` → `settleAfterQuiescence`**：改名伴随三道门语义的显式化（A00）；
- **组装器新增 `assembled()`**：max-tokens 的 keep/drop 决策与 replay 元数据剪裁统一到一处——"Emitted blocks and replay metadata both derive from this result, so they cannot disagree"（课程十二 L05 的演进注脚）。

**rc.7 → master（743 commits）：决策存活，发布管道生长。** 本课程全部 44 个锚点在 master（`b150a551`）上经锚点校验器逐条复核**全部存活**——"never queues a late user message"、"Exactly one per ask"、"records die with the harness process"、"do not ration real-API tests" 原文仍在（毕业项目第 2 步可亲手复跑这条证明）。生长的是发布侧外围：`.github/workflows/` 从 15 个到 18 个，新增 `ci-master.yml`、`release-publish.yml`、`release-vendor-publish.yml` 三条发布管道；平台验证 lane（landlock-run、e2b-e2e、pi-ai-provider-e2e、sandbox）在 rc.5 就已齐备，本窗口零增减；jobs/preset 的 diff 只有版本号与文档级的小改。

**这个模式本身就是结论**：好决策的表现不是"永远不变"，而是**核心不变量稳定、外围按压力方向生长**——事件溯源的配平纪律不需要改；产品走向公开发布时，长出来的是发布管道，不是核心特例。

## 毕业项目：亲手做一次 drift 审计

命令由课程作者在锁定环境**实测**过（作者输出直接写在命令下方注释里）。`/path/to/awesome-agent-engineering` 替换为本仓在你机器上的绝对路径：

```bash
repo="$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
cd "$repo"

# 1. 同一校验器、两个快照：rc.5 树断，rc.7 树绿——锚点校验让"过期"变成响亮信号（实测）
git checkout --detach 47f9438                                    # rc.5
DSH_SOURCE_DIR="$repo" node --experimental-strip-types \
  /path/to/awesome-agent-engineering/deepseek-harness-lessons/scripts/check_anchors.ts
#   BROKEN ANCHOR [missing-symbol]: packages/acp/acp/src/index.ts (settleAfterQuiescence)
#   1/82 anchors broken（exit 1——课程十二的 82 锚点已对 rc.7 重写，rc.5 树上恰好只断这一个）
git checkout --detach 99f6f02                                    # rc.7，课程锁定快照
DSH_SOURCE_DIR="$repo" node --experimental-strip-types \
  /path/to/awesome-agent-engineering/deepseek-harness-lessons/scripts/check_anchors.ts
#   anchors: ok

# 2. 本课程 44 锚点对 master 的存活率（实测：44/44 全部存活）
git fetch --quiet --depth=1 origin b150a551b8d465e31e418e1b2eaf5e79bbb7d28e
git checkout --detach b150a551b8d465e31e418e1b2eaf5e79bbb7d28e   # master / 0.1.1-rc.2
DSH_SOURCE_DIR="$repo" node --experimental-strip-types \
  /path/to/awesome-agent-engineering/deepseek-harness-advanced-lessons/scripts/check_anchors.ts
#   anchors: ok——"决策存活"从抽查升级为机械证明

# 3. 找三个"课程没讲但 master 长出来"的东西（按 diff 量排序，肉眼归因）
git diff --stat 99f6f02 b150a551 -- packages/ | sort -t'|' -k2 -rn | head -20

# 4. 收尾：把 checkout 还原到锁定快照（后续漂移检查依赖它）
git checkout --detach 99f6f02
```

## 交付物

写一份**迁移报告**（存进本课目录 `migration-notes.md`）：

1. **存活清单**：本课程 44 个锚点在 master 上的校验器输出（作者实测为全绿——把这份输出原样引用；若有红，逐条列出）；
2. **断裂清单**：哪些锚点在 master 变红，逐条归因（改名？搬家？语义变化？）——实测为空集也是结论：说明课程窗口内符号零漂移；
3. **消费者兼容矩阵**：按 A01/A02 的视角评估——一个依赖 receipt 协议的 SDK 客户端、一个自定义 preset、一个 jobs 消费者，各自跨 rc.7→master 要改什么；
4. **课程修正建议**：本课程哪些结论应该改写、哪些只是快照事实过期（对照三层事实纪律）；
5. **升级门槛建议**：如果课程要换锁到 master，按"先跑兼容矩阵、再决定"的流程列出必须全绿的检查点清单。

## 全课收束：决策质量的判据

1. **锁快照与追演进不矛盾**：锚点校验器让"过期"从错觉变成信号——课程对每个 SHA 负责，切换是显式决定。
2. **演进方向是决策质量的证据**：核心不变量冻结 + 外围按压力生长，说明分层切对了。
3. **改名与拆模块是演进的主要形态**：语义漂移远比人们担心的少，符号漂移远比人们预期的多——所以锚点校验值得自动化。
4. **消费者视角评估升级**：不是"上游变了什么"，而是"每类消费者要改什么"。

这套判据本身也有代价：锚点校验只能抓**符号级**漂移（路径、注释、导出名），抓不住语义级漂移（同名函数换了行为）——所以迁移报告必须包含消费者兼容矩阵，而不能只看锚点绿灯。

## 动手验证（在真实 checkout 里）

本案例的毕业项目本身就是动手验证（三快照 drift 审计）。最短路径版本：

```bash
# 复现一次真实的锚点漂移：课程十二旧锁 rc.5 的符号在 rc.7 已改名
repo="$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
cd "$repo"
grep -n "settleAfterQuiescence" packages/acp/acp/src/index.ts | head -2             # rc.7 名字
git show 47f9438:packages/acp/acp/src/index.ts | grep -n "settlePrompt" | head -2   # rc.5 名字
```

同一个函数、两个快照、两个名字——这就是"符号漂移远比语义漂移多"的实证，也是锚点校验值得自动化的原因。

## 证据边界

- master 侧观察基于 2026-08-27 的 `b150a551`；它还在跑。
- 毕业项目在可丢弃 checkout 里做；迁移报告的结论带 SHA 与日期，不外推到未来版本。
