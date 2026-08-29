# L09：Subagent、Jobs、Workflow 与所有权

> 本课问题：子任务的新建、fork、后台续跑、worker workflow 分别意味着什么？哪些状态能活过重启？

三种"把工作移出当前对话"的机制，三种不同的所有权与持久性边界。读完本课你应该能在拿到需求时回答"该用哪种"。

## 常规做法会怎么坏：把"移出对话"当成一件事来写

常规做法里这些需求会长成同一种代码：子任务 = 递归调用自己，后台任务 = 一个内存 Map 加 `setInterval`。四个场景暴露它的问题——dsh 的答案全部有源码或文档背书：

1. **agent 生 agent 失控。** 递归没有预算，子代理再开子代理直到资源耗尽。dsh 在 durable 元数据里放 `delegationDepth`（递归预算，注释明说 "durable: must survive persistence and resume"），并在提示词层面告知子代理"你的权限域封死、不能内部扩权"（`SUBAGENT_DELEGATION_CONTEXT`）。
2. **"从中间分叉一个会话"。** 常规做法任意位置复制数组——但进行中的 turn 不配平、不可重放（L04）。dsh 的 fork 只取 `completedTurnPrefix`（到最后一个 `turn/end` 的平衡前缀）：**数据结构的可重放性反过来决定了 API 的形状**。
3. **重启后后台任务全丢，UI 却假装还在。** dsh 的选择是把丢失写成文档（`jobs-local` README：jobs 是 process-local 的，durable 是 seam 预留的扩展位）——易失性是声明的，不是伪装的。
4. **靠藏 id 保护后台任务。** 可预测的 id 被当成漏洞去"修复"（换 UUID），dsh 的立场写在注释里："Ids are predictable, so **authorization — not secrecy** — is the boundary"——校验 owner 身份，而不是隐藏标识。

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

## 这样设计买到了什么，付出什么

1. **"用哪种机制"变成有据可查的选型**——上表四行（durable？谁能动？崩溃后？边界性质？）就是决策检查表；常规做法里三种需求长成同一种代码，边界问题到事故时才暴露。
2. **失控在结构上有顶**——delegationDepth 预算 + 权限域封死的提示词声明 + workflow 的并发/总数/超时限额：递归失控这个 agent 系统经典事故被多层封顶。
3. **重启后"丢什么"是明示的**——子会话可恢复、jobs 记录消失（写进 README）、workflow run 消失但各 agent 日志仍在。消费者可以据此选择机制，而不是事后发现。
4. **授权边界不怕标识泄漏**——id 出现在日志、崩溃报告、客户端缓存都没关系，因为边界是服务端身份校验，不是猜不到的 token。

**代价**：想要 durable 的后台任务就得自己实现 `JobRegistry` seam（上游尚未提供——这是声明过的缺口，不是隐藏的）；三种机制并存也意味着调用方必须理解它们的边界差异，上游用文档与命名（`-in-process`、`jobs-local`）持续提醒。

## 证据边界

- `jobs-local` 的恢复缺口是**当前快照的事实**，上游可能在后续版本实现 durable backend（课程十三 L07 的 drift 检查点之一）。
- subagent 的 out-of-process provider（acp/codex/claude-code）广播 `NO_START_CAPABILITIES`——无法执行的父约束在 start 前拒绝而非静默忽略；本课不深入这些集成。
