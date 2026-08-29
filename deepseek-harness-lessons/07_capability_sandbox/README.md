# L07：Capability Seam、作用域与执行安全

> 本课问题：怎样替换执行环境（本地 → 沙箱 → 远程）而不 fork 工具、不修改循环？

L06 讲了单个工具调用怎么过管线；本课讲能力（capability）怎么组织，才能让"换执行环境"变成一次配置改动。

## 阅读地图

1. `docs/capability-seams.md` —— 能力图谱：先建立全局感
2. `packages/core/scope/src/index.ts` —— agent 作用域与事件上行
3. `packages/fs/fs/src/index.ts` —— Service Definition 长什么样
4. `packages/fs/tool-fs/src/index.ts` —— Consumer 长什么样
5. `packages/fs/fs-sandbox/src/index.ts` —— Provider 替换有多小
6. `packages/sandbox/sandbox-policy/src/index.ts` —— 策略唯一家
7. `packages/sandbox/sandbox/src/index.ts` —— native 隔离层
8. `packages/interaction/user-approval/src/index.ts` —— 审批缝隙

## 精读一：三角色缝隙，以 `ctx.fs` 为例

一个 seam 由三个角色构成，缺一不可：

- **Service Definition**：`fs/src/index.ts` 的 `abstract class FileSystem extends Service`——声明接口（含 `fs/write-intent` 等事件词汇），不实现；
- **Provider**：`fs-local`（真实文件系统）、`fs-sandbox`（继承 local，只在两个 mutation 上加策略围栏）、`fs-e2b`（远端）；
- **Consumer**：`tool-fs`——面向模型的 read/write/edit 工具，`inject = ['tools', 'fs', 'systemPrompt']`，**永不 import 具体 provider**。

替换的完整成本：组合处把 `dsh-fs-local` 换成 `dsh-fs-sandbox`，加一个 `ctx.sandboxPolicy`——**consumer 与 loop 零改动**。Cordis 的单实现约束（装载第二个 provider 直接 duplicate-service 抛错）保证"当前 fs 是谁"永远无歧义。

执行世界的一致性靠组合保证而非口头约定：`e2b` 的 fs/subprocess/shell adapter 等待同一个 SDK handle，"filesystem and process operations inhabit one remote Linux world"；本地侧 `bash-sandbox` 与 `fs-sandbox` 从**同一个** `writableRoots` 函数解析可写根——"so bash and fs cannot drift"。

## 精读二：作用域——注册的归属

`core/scope` 给出三个原语：`createScope`（铸一个 opaque key + 子 fiber）、`bindScopeParent`（一次性父链绑定，环检测）、`scopeTarget`（事件只上行——祖先 listener 收到后代事件，原文搜 "events flow up the chain, never"）。每个 Agent 有自己的 `agent.ctx`，工具注册、事件监听落进该 scope 层；dispose agent scope 时整组注册回卷（回到 L01 的 effect 机制）。这是"两个 agent 看到不同工具集、不同 provider"的全部机制。

## 精读三：策略层与内核层，各自诚实

这是本课最值得学的一段设计。三层分开：

1. **策略唯一家**：`sandbox-policy` 的 `SandboxPolicyService`——部署默认（**read-only 是 fail-safe 默认**）+ 会话 override 的 fold + 每次 `resolve()` 出完整策略。文件、bash、终端消费者读**同一份**解析结果，防止圈出不同的根。
2. **fs 侧 = 进程内围栏**：`fs-sandbox` 头注释自我声明（原文搜 "NOT a kernel boundary"）："The fence is a policy check in TRUSTED code over a MODEL-CONTROLLED path, NOT a kernel boundary … Kernel-grade isolation of untrusted CODE stays `ctx.shell`'s job." 委托前重新 canonical 化目标路径防 check-here-write-there TOCTOU；拒绝抛结构化错误（"an in-process fence knows exactly what it refused"）。
3. **shell 侧 = native 隔离**：`SandboxProvider.confine(argv, policy)` 返回 `ConfinedArgv`，其中 `enforcement: 'full' | 'partial'` 是**后端自报的诚实度**——"callers requiring an absolute boundary must not treat it as full"；`denialSignatures` 是该后端自己的拒绝方言（bwrap 的 EROFS、Landlock 的 EACCES、Seatbelt 的 EPERM），消费者只匹配自家方言；后端不可用时抛 `SANDBOX_UNAVAILABLE` "refusing to run the command unconfined"——**fail-closed 端点，绝无静默穿透**。

## 精读四：审批——fail-closed 与成对审计

`tools/pre-execute` 的 `ask` 决策走 `ctx.get('approval')` 缝隙。`user-approval/src/index.ts` 的纪律：

- waterfall 的默认终点是 `'unavailable'`——没有 answerer、answerer 抛错、返回词汇表外的值，**全部**归一到 fail-closed 的 unavailable（注释："A throwing answerer must fail the QUESTION closed, not the caller's tool call open"）；
- 审计成对：每次 ask 先落 `approval/asked`，决出后落 `approval/decided`——"Exactly one per ask"；任一审计写入失败则整次 request reject（"returning an unlogged decision would violate the pair"）；
- `allowed-once` 是唯一授权且只作用于被问的那一次调用；沙箱升级（escalation）在任何执行之前完成，grant 只 stamp 到本次调用。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 数一数换 provider 要动几处（答案应该是：组合处一处）
cat packages/fs/fs-sandbox/src/index.ts | head -30
# 读诚实声明
grep -n "NOT a kernel boundary\|cannot drift\|refusing to run" packages/fs/fs-sandbox/src/index.ts packages/shell/bash-sandbox/src/index.ts packages/sandbox/sandbox/src/index.ts
# 审计成对的测试证据
grep -rn "approval/asked\|approval/decided" packages/interaction/user-approval/tests/*.spec.ts | head -5
```

## 设计思想

1. **缝隙三角色齐备才算能力**：只有接口没有 provider 是空谈，只有 provider 没有 consumer 是死代码；"加一个能力"意味着设计三份东西（Definition/Provider/Consumer）。
2. **能力事实要诚实**：`enforcement: 'partial'`、进程内围栏自declare"containment not a security boundary"、`SANDBOX_UNAVAILABLE` fail-closed——系统不假装有它没有的隔离强度。
3. **策略集中、单一解析点**：所有消费者读同一份 resolved policy，两个执行器圈出不同根这个 bug 品类被结构性消灭。
4. **审批默认关闭、审计成对**：fail-closed 的兜底 + 每问必有一对 durable 事件，事后可审计。

## 证据边界

- 平台原生隔离（Landlock/Seatbelt/E2B）的实际强度是环境相关证据；本课证明的是分层的**结构**，macOS 上读 policy 代码不能推导 Linux 内核隔离的强度。
- 平台沙箱实测属可选实验，本课不要求。
