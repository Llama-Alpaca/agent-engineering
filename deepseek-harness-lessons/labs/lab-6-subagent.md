# Lab 6：子代理——委派一个真实子会话

**目标**：让父代理通过内置的 `subagent` 工具委派一个子代理，并在磁盘上找到那个子代理的 durable 会话。做完你会确切知道：委派的语义（spawn 干净房间）、子会话的持久性边界、以及为什么"谁活过重启"是有账可查的。

## 第 1 步：配置委派剧本

base 组合**本来就带** in-process spawn 后端和 `subagent` 工具（`packages/bundle/base/cordis.patch.yml`）——你不需要加任何行，只需要让 scripted 模型调用它（`overlays/lab-6.yml`）：

```yaml
- id: lab-scripted-llm
  name: '/path/to/your/deepseek-harness/examples/lab-src/scripted-llm.ts'
  config:
    firstToolCall:
      name: subagent
      args:
        description: 'Greet from the child'
        prompt: 'say hello from the child'
    childMarker: 'say hello from the child'
    childFinalText: 'Child complete: I am the spawned subagent.'
    finalText: 'Lab 6 complete: the parent delegated to a spawned child and read its answer.'
```

`childMarker` 是 adapter 的"剧本分支"：子代理的请求里带着这句 prompt，直接收尾；父代理等到工具结果后收尾。跑：

```bash
export DSH_HOME=/tmp/dsh-lab-home
pnpm dsh --profile headless --patch examples/lab-6.yml "delegate a greeting"
```

stdout 最后一行（真实输出）：`Lab 6 complete: the parent delegated to a spawned child and read its answer.`

## 第 2 步：找到子会话

```bash
ls -t $DSH_HOME/sessions/--path-encoded-cwd--/ | head -3
```

你会看到**两个**新会话。分别解开头一行（真实输出）：

```text
# 子：
{"type":"session","version":0,"id":"8edc2e3f-f459-...","cwd":"/private/tmp/dsh-study",
 "parentSession":"session-49cc2029-f716-...","origin":"subagent","deleg...}

# 父：
{"type":"session","version":0,"id":"session-49cc2029-f716--...","cwd":"/private/tmp/dsh-study",
 "delegationDepth":0}
```

三个字段说明一切：`parentSession`（血缘）、`origin: "subagent"`（出生方式）、子会话头里 `delegationDepth` 为 1（递归预算消耗了一层——这是 **durable** 元数据，"must survive persistence and resume"）。

## 第 3 步：读懂你刚刚用到的三个设计决策

1. **spawn 是"干净房间"。** `subagent-spawn-in-process` 的 `inheritsParentContext = false`——子代理看不到父的上下文，只看到你给的 prompt。想"带着前情"要用另一个 provider：fork（复制 `completedTurnPrefix` 平衡前缀）。为什么只复制到上一个 `turn/end`？进行中的 turn 不配平、不可重放（Lab 4 你刚验证过配平）——**日志的可重放性反过来决定了 fork API 的形状**。
2. **子会话是 durable 的，运行态不是。** 进程死了，两个会话日志都在磁盘上；"一个 durable Session + 至多一个进程内 Activation"。对照 jobs：进程内记录、README 明写 "records die with the harness process"。三种机制（subagent/jobs/workflow）谁活过重启，是**声明过的设计**而不是运气（深读 09 章的对比表）。
3. **委派是普通工具调用。** 你的 scripted adapter 只发了 `name: subagent` 的 tool-call——委派、后台任务、审批升级，在模型看来全是工具；在系统里全走 Lab 3/5 那条管线。

## 第 4 步（可选）：看子代理的权限声明

在子会话日志里找 `SUBAGENT_DELEGATION_CONTEXT` 相关的 user/message——运行时固定告知子代理"你的权限域封死、不能内部扩权"。子代理知道自己是被委派的，提示词层面就不鼓励它请求越权。

## 回答三个问题再走

1. 父子会话各自的 `delegationDepth` 是多少？这个预算为什么必须 durable？
2. spawn 与 fork 是性能选项还是语义选项？"换个视角重看同一段历史"该用哪个？
3. 如果委派时父代理正在跑一个长任务，子代理的日志写到哪、父的 `tool/result` 什么时候落账？

## 变体实验

把 overlay 里 `subagent` 的 provider 行为改掉做不到（那是 base 的行），但你可以 insert 一个 `subagent-fork-in-process` 行（照抄 `examples/headless-agent/cordis.yml` 的 fork 段，**记得给行 id 加前缀**，否则 `duplicate loader entry id`）+ 挂 `tool-subagent` 的 fork 变体，让剧本走 `subagent_fork`——对比 fork 出的子会话头（`seedLength`、无 `parentSession`？去验证你的预测）。
