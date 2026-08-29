# L09：Subagent、Jobs、Workflow 与所有权

> 本课问题：子任务的新建、fork、后台续跑、worker workflow 分别意味着什么？哪些状态能活过重启？

三种"把工作移出当前对话"的机制，三种不同的所有权与持久性边界。读完本课你应该能在拿到需求时回答"该用哪种"。

## 阅读地图

1. `docs/subsystems/subagent.md` —— 官方定位与对比表
2. `packages/subagent/subagent-spawn-in-process/src/index.ts` —— fresh spawn
3. `packages/subagent/subagent-fork-in-process/src/index.ts` —— fork 前缀
4. `packages/jobs/jobs/src/index.ts` + `packages/jobs/jobs-local/` —— 后台任务
5. `packages/workflow/workflow/src/index.ts` + `workflow-worker-thread/` —— 编排与 worker

## 精读一：spawn vs fork——起点决定语义

subagent 是 provider 注册制的（`ctx.subagents.registerProvider`），两种进程内 provider：

- **spawn**：全新子 agent，`inheritsParentContext = false`——干净房间，适合"换个视角重看"；
- **fork**：从父会话的 `completedTurnPrefix` 复制前缀——截到最后一个 `turn/end` 的**平衡前缀**。为什么不是任意位置？因为 L04 说过：进行中的 turn 不可重放（日志配平才能投影）。fork 的边界纪律直接由日志的可重放性决定。

子会话本身是 durable 的：`childSessionMeta` 记录 `parentSession`、`origin:'subagent'`、`delegationDepth`（递归预算，注释明说 "durable: must survive persistence and resume"）、`seedLength`。continuable 子代理是"一个 durable Session + 至多一个进程内 Activation"——冷恢复时从持久 descriptor 重建。

一个值得注意的运行时声明：`SUBAGENT_DELEGATION_CONTEXT` 固定告知子代理"你的权限域封死、不能内部扩权"——子代理知道自己被委托，提示词层面就不鼓励它请求越权。

## 精读二：Jobs——所有权围栏与诚实的易失性

`jobs` 包是抽象契约（`JobRegistry`，直接实例化会在构造器抛错），`jobs-local` 是进程内实现。三条纪律：

1. **owner fence**：`job.owner.id !== caller?.id` 直接拒绝——"Ids are predictable, so **authorization — not secrecy** — is the boundary"（id 可预测没关系，授权才是边界）。owner 还必须是 registry 当前注册的那个 agent 实例。
2. **first-wins 结算**：最早的终局唯一落账——teardown 的强制失败不会被迟到的 producer 结算覆盖；completion 最后宣布（"a reporter may open a model turn synchronously"，其他观察者必须先看到已提交的记录）。
3. **易失性是声明的**：`jobs-local` 的 README Known Limitations 直接写 "Jobs are process-local — records die with the harness process"。跨重启恢复是 seam 预留的扩展位（实现另一个 `JobRegistry`），不是现状——上游不把进程内状态伪装成 durable 的。

## 精读三：Workflow——observe-only 事件面与诚实的 worker 边界

`WorkflowEngine` 是 observe-only 的事件面（`workflow/start|phase|log|agent-start|agent-end|end`）——注意 `workflow/end` **刻意不带结果值**：引擎只负责观察与通知，结果在 durable session log 里。worker-thread 引擎的模块头注释是本课最重要的诚实声明：

> it is **containment rather than a security boundary**

worker + escapable vm 提供的是"失控脚本能被终止"的遏制边界（限额：并发 agent 上限、总 agent 数 1000 回止、同步超时、dispose 宽限后 TERMINATE），不是对抗恶意代码的安全边界。host 侧还有同步的 `assertBodyParses`——为了让 `start()` 保持"语法错误同步抛"的契约，host 宁可多解析一次。

## 三机制对比（本课的出口检查表）

| 维度 | subagent | jobs | workflow |
|---|---|---|---|
| 会话 durable？ | 是（子会话入日志） | 否（进程内记录） | 否（run 易失，agent 会话各自 durable） |
| 谁能读/杀 | 父（经工具） | owner fence | 引擎 + 观察者 |
| 崩溃后 | 子会话可恢复 | 记录消失（声明过） | run 消失，各 agent 日志仍在 |
| 边界性质 | 权限域封死（声明） | authorization-not-secrecy | containment-not-security |

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# fork 前缀的平衡纪律
grep -n "completedTurnPrefix\|turn/end" packages/subagent/subagent-fork-in-process/src/index.ts | head
# jobs 的三条纪律各自的代码位置
grep -n "belongs to another session\|first\|process-local" packages/jobs/jobs-local/src/index.ts packages/jobs/jobs-local/README.md | head
# worker 的诚实声明与限额
grep -n "containment rather than a security boundary\|maxTotalAgents\|TERMINATE" packages/workflow/workflow-worker-thread/src/index.ts | head
```

## 设计思想

1. **起点决定语义**：spawn（干净房间）与 fork（平衡前缀）不是性能选项，是语义选项；fork 的边界由日志可重放性反过来决定——数据结构约束了 API 的形状。
2. **授权而非保密**：可预测 id + owner fence；把"猜 id"从攻击面里去掉的方法不是隐藏 id，是校验身份。
3. **易失性要声明，不要伪装**：jobs 与 workflow 的 README 都把"重启即失"写成 Known Limitations；durable 留作 seam 扩展位。
4. **遏制与安全是两回事**：worker thread 能终止失控代码，不能对抗恶意代码——声明清楚，消费者才不会错用。

## 证据边界

- `jobs-local` 的恢复缺口是**当前快照的事实**，上游可能在后续版本实现 durable backend（课程十三 L07 的 drift 检查点之一）。
- subagent 的 out-of-process provider（acp/codex/claude-code）广播 `NO_START_CAPABILITIES`——无法执行的父约束在 start 前拒绝而非静默忽略；本课不深入这些集成。
