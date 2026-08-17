# L00：开箱、版本锁定与源码地图

这节课先回答一个边界问题：我们究竟在学习哪个 Harness？课程锁定上游 commit
`47f943859bef60e4160492346772ded9b24f765a`，而不是跟随 `master`。源码快照的根版本是
`0.1.0-rc.5`；规划时 npm `latest` 已经是 `0.1.0-rc.6`，因此版本漂移本身就是第一个实验对象。

## 真实源码锚点

- 根 `README.md`、`package.json`：developer-preview 边界、版本、Node/pnpm 与 workspace。
- `apps/cli/src/bin.ts`：CLI 参数和启动入口。
- `apps/cli/src/profile-boot.ts`：profile、bundle、patch 组装入口。
- `docs/architecture.md`、`docs/module-graph.md`：从 Loader/Cordis 到 Agent loop 的模块图。

本课代码不复制上游，也不要求安装上游 workspace。它读取课程仓库的
`upstream.lock.json` 与 `source-manifest.json`，再用一个小型 replay fixture 展示两个证据层：

| 层 | 例子 | 能否用于 resume |
|---|---|---|
| durable session log | `turn/start`、`request/header`、`assistant/message` | 可以，模型上下文应从日志重建 |
| live Cordis event | `agent/status`、`agent/request` | 不可以，它只描述当前进程的协调 |

## 跑实验

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 00
node --experimental-strip-types deepseek-harness-lessons/00_baseline_source_map/tests/trace.test.ts
```

输出是确定性的 JSON：包含锁定 SHA、源码锚点、durable/live 计数、一个 async-generator
stream bridge，以及两个失败注入（锁漂移、未配平 replay）。不需要 API Key 或网络。

## 读代码时抓住三件事

1. `verifyLock()` 把 commit 当作行为输入；完整 SHA 比版本号更可靠。
2. `buildBaselineEventTrace()` 刻意把 durable 和 live 放在同一时间线上，避免把实时通知误当持久事实。
3. `consumeScriptedStream()` 用 discriminated union + async generator 做 TypeScript 桥接；后续 L05 会把同样的边界换成真正的 LLM adapter。

离线 fixture 只能证明状态机和审计纪律，不能证明真实模型质量、CLI 启动成功或上游所有测试通过。要做真实源码实验，先在 disposable checkout 中运行 `scripts/prepare_upstream.sh`，再按锁定 SHA 检查 manifest。
