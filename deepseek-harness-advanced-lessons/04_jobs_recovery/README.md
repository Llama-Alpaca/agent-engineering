# A04：所有权围栏——Jobs、Workflow 与恢复边界

> 决策案例：后台任务的 id 是可预测的 `<kind>-N`。把 id 藏起来（保密）还是校验身份（授权）？进程内记录重启即失，是补一个假装持久的层，还是把丢失写成文档？本课讲三个"把工作移出对话"的机制怎么回答各自的边界问题。

## 阅读地图

1. `packages/jobs/jobs/src/index.ts` —— 抽象契约
2. `packages/jobs/jobs-local/src/index.ts` —— 进程内实现（本课主菜）
3. `packages/jobs/jobs-local/README.md` —— 易失性的诚实声明
4. `packages/workflow/workflow/src/index.ts` —— observe-only 事件面
5. `packages/workflow/workflow-worker-thread/src/index.ts` —— worker 边界
6. `packages/subagent/subagent-fork-in-process/src/index.ts` —— 对照：durable 的那种

## 案例一：authorization, not secrecy

`jobs-local` 的 `assertAccess`：`job.owner.id !== caller?.id` → 直接拒绝，错误信息 "belongs to another session"。源码注释把设计立场写成一句格言：

> Ids are predictable, so **authorization — not secrecy** — is the boundary.

可预测的 id 不是漏洞，前提是每个操作都校验"操作者是不是 owner（且是 registry 当前注册的那个实例）"。对照方案"用不可猜的 id 当能力令牌"：令牌会泄漏（日志、崩溃报告、客户端缓存），而授权关系绑定在服务端状态上。准入还有能力检查：`servesOwner`——该 owner 的组合里没有任何 controller 服务它就拒绝，错误信息直接指路 "load @deepseek-ai/dsh-tool-jobs in its composition"（宁可报错指路，不静默降级）。

## 案例二：first-wins 结算与宣布顺序

`jobs-local` 的 `settle` 有三层纪律，注释逐一给了理由：

1. **first-wins**：`if (isTerminal(job.status)) return`——teardown 的强制失败不被迟到的 producer 结算覆盖；
2. **先落账再放行**：waiter 的 resolver 在记录提交之后才 resolve——醒来的人永远看得到最终事实；
3. **completion 最后宣布**："a reporter may open a model turn synchronously"——reporter 会立刻开模型 turn，其他观察者必须先看到已提交记录。

## 案例三：易失性是声明的，不是伪装的

`jobs-local` README 的 Known Limitations 第一句："**Jobs are process-local** — records die with the harness process; durable or cross-restart execution needs a separate backend implementing the seam." durable 是 `JobRegistry` 这个抽象 seam 预留的扩展位。对照 `subagent-fork-in-process`：子会话本身是 durable 的（fork 只取 `completedTurnPrefix` 平衡前缀）。三种机制摆在一起，恢复边界一目了然：

| | durable 部分 | 易失部分 | 重启后 |
|---|---|---|---|
| subagent | 子会话日志 | 运行态 Activation | 会话可恢复重放 |
| jobs | 无 | 全部记录 | 任务消失（声明过） |
| workflow | 各 agent 会话 | run 状态 | run 消失，日志仍在 |

## 案例四：worker 是遏制，不是安全

`workflow-worker-thread` 的模块头注释："it is **containment rather than a security boundary**"。worker + escapable vm 解决的是"失控脚本能被终止、被限额"（并发 agent 上限、总数 1000 回止、同步超时、dispose 宽限后 TERMINATE），不解决"恶意代码逃逸"。host 侧 `assertBodyParses` 同步预解析——为了保住 `start()` 同步抛语法错误的契约，宁可解析两次。`workerSpawnEnv` 清洗为空环境——worker 里没有 ambient credentials。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
grep -n "belongs to another session" packages/jobs/jobs-local/src/index.ts
grep -n "First-wins preserves a teardown force-failure" packages/jobs/jobs-local/src/index.ts
grep -n "records die with the harness process" packages/jobs/jobs-local/README.md
grep -n "containment rather than a security boundary" packages/workflow/workflow-worker-thread/src/index.ts
```

## 这样决策买到了什么，付出什么

1. **授权优于保密**：可预测标识 + 身份校验 > 不可猜令牌；把"猜 id"从攻击面移除靠的是校验，不是隐藏。
2. **结算一次、落账先行、完成最后**：三层顺序各防一种竞态（覆盖、幻读、乱序观察）。
3. **易失性写进文档，durable 留成 seam**：不伪装、不半吊子补层——"进程内"是明示的当前事实。
4. **遏制与安全是两种边界**：能终止 ≠ 能对抗；声明清楚，消费者才不会把 worker 当沙箱用。

**代价**：`<kind>-N` 的可预测 id 意味着**每个**访问路径都必须过 `assertAccess`——漏一处校验就是漏洞，这个纪律没有类型系统兜底（不像 A05 的闭联归一）；"重启即失"虽然诚实，但把"要不要 durable"的工程决策推给了每个使用者，seam 至今没有人填。

## 证据边界

- "process-local" 是 `99f6f02` 的现状；上游后续版本若实现 durable backend，本课锚点（README 那句话）会漂移——那正是 A07 毕业课要检查的。
- worker 限额的具体数值是实现细节，随版本可调。
