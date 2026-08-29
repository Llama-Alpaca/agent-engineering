# A06：证据分层——五条测试 lane 的设计

> 决策案例：一个有两百多个包、要接真模型的产品，CI 怎么设计才既"没 key 也全绿"又不自欺？上游的答案是把"能证明什么/绝不能证明什么"写成分工明确的五条 lane，并且对真实 API 的态度是反直觉的："do not ration real-API tests"。

## 阅读地图

1. `docs/testing.md` —— 分层哲学（本课纲领，先整读）
2. 根 `package.json` 的 scripts —— lane 的入口
3. `scripts/run-gates.ts` —— CI 门禁的组合逻辑
4. `.github/workflows/ci.yml` + `e2e.yml` —— lane 与 workflow 的对应
5. `vitest.snapshot.config.ts` —— snapshot lane 的 replay 纪律

## 五条 lane 与各自证明了什么

| lane | 入口 | 证明 | 绝不证明 |
|---|---|---|---|
| unit + coverage 门 | `pnpm test` / `check:ci:coverage` | 局部不变量；per-file 100% 覆盖门（"An uncovered line is often dead code the gate is correctly flagging for deletion"） | 发布入口可用 |
| keyless snapshot / real-composition | `test:snapshot`（`vitest.snapshot.config.ts`） | 从**构建产物**启动真实示例进程、回放录制会话；ACP snapshot 钉死完整 system-prompt/tool-schema | provider 当前的真实行为 |
| real-API e2e | `test:e2e`（`e2e.yml`，需 secret） | 真模型闭环 | 无 key 环境的任何东西；preflight 在 key 缺失时**硬失败防假绿** |
| browser snapshot | `test:web` / `test:web:built` | Web UI 回放 | 交互手感、视觉品质 |
| python lane | `python-sdk` / `python-runtime` job | 3.10 keyless pytest；runtime 单包快照 | TS 侧行为（那是 TS lane 的事） |

三个值得精读的设计决定：

**1. replay 只读纪律。** CI 强制 `DSH_SNAPSHOT=replay`——"CI forces read-only replay, never writing expected outputs"。录制 expected 只能是开发者本地的显式动作；CI 里的回放永远只读。这一条杜绝了"CI 顺手把错误输出固化成新基准"的经典事故。

**2. real-API 不配给。** `docs/testing.md` 的原话："We are DeepSeek — **do not ration real-API tests**"。每套件无 key 时自跳过，但有 key 时不设配额。同时 e2e 的 preflight 在 key 缺失时硬失败——"skipped 报 successful"只用于 fork/Dependabot PR 这类拿不到 secret 的场景（job 级 `if:`），required check 因此不被假绿污染。反直觉但自洽：**离线 lane 保证工程结构，真 API lane 保证真实能力，两者都不冒充对方**。

**3. built-artifact smoke。** snapshot lane 从**构建产物**（`DSH_EXAMPLE_MODE=lib`）启动示例而不是从源码直跑——"mock 全绿、发布入口失败"的负例被这条 lane 结构性覆盖。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
sed -n '1,50p' docs/testing.md
grep -n '"test' package.json | head -10
grep -n "coverageGates\|snapshotGate\|webSnapshotGate" scripts/run-gates.ts | head -6
grep -n "DSH_SNAPSHOT\|replay" .github/workflows/ci.yml | head -5
grep -n "DEEPSEEK_API_KEY\|preflight" .github/workflows/e2e.yml | head -5
```

## 设计思想

1. **先声明每条 lane 不能证明什么**。"能证明什么"人人会写；"绝不证明什么"才是分层的护栏——结论分栏，永不混报。
2. **CI 只读基准**：回放纪律让"基准漂移"只能是显式的人类决定。
3. **覆盖门是删除死代码的工具**，不是炫耀数字：100% per-file 的理由写在文档里。
4. **真实资源不配给、但要防假绿**：有 key 就尽量测，无 key 时 preflight 硬失败而不是静默 skip。
5. **从发布形态测发布入口**：built-artifact smoke 把"源码能跑"与"产物能跑"分开。

## 证据边界

- lane 划分与 CI 态度对 `99f6f02` 负责；HEAD 上 workflow 数量已显著增长（A07 的观察点）。
- 性能/stress 属手动入口，不在五条 lane 内——上游不宣称吞吐 SLA，本课也不引用性能数字。
