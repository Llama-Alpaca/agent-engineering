# L04：Jobs、Workflow 与恢复边界

DeepSeek Harness 的 background jobs 与 dynamic workflow 解决的是两种不同的长任务问题：Jobs 让 producer 的工作脱离当前 step 并可查询/停止；Workflow 在 worker thread 中执行动态编排，并通过 host-side child RPC 启动 Agent。

## Jobs 的当前契约

- 状态是 `running -> stopping -> completed|killed|failed`。`kill()` 先调用 producer `cancel()`；只有它成功返回才提交 `stopping`。
- `stopping` 仍占 owner 容量，直到 producer `done` 真正结算并释放资源。
- terminal settlement first-wins；listener 在记录提交之后才收到快照。
- start 用精确 live Agent 做 ownership/preflight，读写用 session id 授权。job id 可预测，不能承担保密职责。
- busy owner 的未报告完成进入下一 step；idle owner 可按 `completionDelivery` 唤醒。`maxConsecutiveWakes` 防止完成通知自激循环。
- 输出与通知按 UTF-8 bytes 截断，不能切出损坏字符。

最重要的负面事实：当前 `jobs-local` 明确是 process-local provider，所有记录都在内存里。进程重启后 job 不恢复。本课目录保留 `jobs_recovery` 名称是为了研究“恢复边界”，不是宣称上游已经提供 checkpoint/lease journal。

## Workflow 的当前契约

- host 验证 script meta、provider 和 cap，worker 通过 ready/go/cancel 握手启动。
- `agent`、`parallel`、`pipeline`、`phase`、`log` 由 worker runtime 驱动；host 保持 child registry，并对 terminal race 做 first-wins。
- 普通 child 失败可投影为 `null`；基础设施失败或 fatal `WorkflowError` 终止整个 run。
- 每个 child 都必须有一对 `workflow/agent-start` / `workflow/agent-end`，取消和 worker death 时由 host 合成缺失的 end。
- realm 返回值必须是 plain JSON；循环、函数、BigInt、exotic prototype 都不能越过边界。
- worker/vm 提供执行隔离与可终止性，不是运行敌意代码的 security sandbox。

## 运行与源码

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/04_jobs_recovery/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/04_jobs_recovery/tests/run.ts
```

Jobs 从 `packages/jobs/{jobs,jobs-local,tool-jobs}` 阅读；Workflow 从 `workflow/src/index.ts` 与 `workflow-worker-thread/src/{host,runtime,session,protocol,realm}.ts` 阅读。课程代码不启动真实进程或 worker，只复现所有权、结算、通知预算和 materialization 不变量。
