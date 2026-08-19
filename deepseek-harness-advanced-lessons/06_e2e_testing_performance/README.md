# L06：E2E、Snapshot、性能与证据边界

本课以固定上游 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` 的 `docs/testing.md` 为准。上游正式测试层不是“unit / contract / integration / E2E / stress”，而是下面五条 repository lane；real-entry、HMR cleanup 和“验证外部世界”是贯穿各 lane 的测试政策。

## 上游正式测试层

| Lane | 命令 | 固定快照中的证据 |
|---|---|---|
| Unit | `pnpm run test` | package/example/repository specs；registry 必须覆盖贡献 fiber dispose 后的 HMR cleanup |
| Coverage gate | `pnpm run test:coverage` | 对配置纳入范围的 `packages/*/*/src` 文件执行 per-file 100% gate；显式 exclusions 见 `vitest.config.ts` |
| Real-API e2e | `pnpm run test:e2e` | 真实 provider；本地默认 source entry，trusted CI 以 `DSH_EXAMPLE_MODE=lib` 测 built entry，并做 key preflight 防止自跳过假绿 |
| Keyless snapshot | `pnpm run test:snapshot` | real subprocess + replay model；比较 normalized protocol output、assembled request 和 re-persisted session log |
| Web browser snapshot | `pnpm run test:web` | 先 build，再用真实 Host composition、HTTP 和 Chromium 比较 `apps/web/tests/snapshots/` 中的 settled ARIA golden |

`dsh-acp-snapshot` 的 replay 是默认只读模式；`record` 调真实模型并更新记录，`refresh` 用已提交 replay 脚本更新派生产物。`normalizeStdout()` 既规范化 JSON-RPC id、UUID 和临时 cwd，也是 stdout 纯度检查。`dsh-llm-replay` 从 session JSONL 的 `assistant/chunk` 和带标记的 `compaction/summary` 重建 stream，并在 teardown 用 `assertConsumed()` 拒绝“少跑了模型调用却仍然通过”。

Web lane 的 `launchWebScaffold()` 在进程内启动真实 Host composition，浏览器通过真实 HTTP 操作 built client。`replay-round-trip.e2e.ts` 还会重新读取真实 bash tool result，而不是相信模型自述；`stats-paged-history.e2e.ts` 则用 56 条 surface message 证明首屏只加载尾页时，全会话统计不会随“Load earlier”改变。

## Perf 与 Stress 不是同一证据

- `pnpm run test:web:perf` 是手动高基数诊断。`complex-history.perf.ts` 保留 workload cardinality 断言并输出测量值，但刻意不设置 wall-time threshold，因为 host 速度不是 correctness contract。
- `pnpm run test:web:stress` 是另一条 opt-in browser lane。`reasoning-chunks.stress.ts` 通过正常 async carrier 投递 100,000 个 reasoning chunk，并对 main-thread delay 和 scheduled-interaction delay 使用当前快照中的 250 ms budget。
- 两者都不在默认 `test:web` inventory 中，不能把一次本地结果当作跨机器性能承诺。

## 本课离线实验

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/06_e2e_testing_performance/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/06_e2e_testing_performance/tests/run.ts
```

`MiniHarnessRuntime` 只做课程自有的 unit、offline contract、offline composition 和 offline scenario 检查。`projectOfflineFixture()` 是一个内存投影 fixture，不是 ACP snapshot，也不是 Web ARIA golden。`modelWorkloadCost()` 只统计确定性的 work units；`p50Units` / `p95Units` 不是毫秒、吞吐或浏览器性能。

代码中的 `UPSTREAM_EVIDENCE` 把五条正式 lane 和两条 opt-in browser 诊断全部标成 `skip`。这不是缺失功能，而是证据纪律：本课程没有安装上游 workspace、构建 published entry、启动 Chromium 或调用真实 API，因而不能声称这些测试通过。

## 源码锚点

- `docs/testing.md`、`vitest*.config.ts`、根 `package.json`：lane、命令和 source/built resolution 规则。
- `packages/test-support/acp-snapshot/src/suite.ts`、`normalize.ts`：`defineAcpSnapshotSuite`、stdout/session normalization 和 fixture guards。
- `packages/test-support/llm-replay/src/index.ts`：`deriveReplayScript`、`installLlmReplay`、`assertConsumed`。
- `apps/web/tests/scaffold.ts`、`replay-round-trip.e2e.ts`、`stats-paged-history.e2e.ts`：真实 Web composition、ARIA golden、外部 world assertion 和分页历史。
- `apps/web/tests/complex-history.perf.ts`、`apps/web/stress-tests/reasoning-chunks.stress.ts`：手动 perf 与带预算的 opt-in stress 的不同边界。
