# L03：Agent Registry、Inbox 与 Turn/Step Loop

> 本课问题：一条用户输入怎样变成一个或多个模型 step？谁在哪个边界上做决定？

Agent 接口与默认实现是拆开的：`packages/core/agent` 拥有 `Agent` 接口、registry、inbox 和 live `agent/*` 事件；`packages/core/agent-loop` 的 `ReactLoopAgent` 是默认 driver。接口与实现分离意味着整个循环可被替换（L07/L11 会用到这一点）。

## 阅读地图

1. `packages/core/agent/src/inbox.ts` —— 两个队列与 claim 纪律
2. `packages/core/agent/src/runtime-types.ts` —— live 事件词汇表与三种输入语义
3. `packages/core/agent-loop/src/agent.ts` —— turn/step 状态机（本课主菜）
4. `packages/core/agent-loop/src/tool-calls.ts` —— 工具调度的有序提交（L06 展开，这里只看接口）
5. `docs/agent-lifecycle.md` —— 事件时序图，读完源码后用它自检

## 精读一：Inbox——两个队列，三种语义

`inbox.ts` 的 `claim` 只有 6 行，却是整个循环的节拍器：

```ts
claim(target: InboxTarget, turn: number): UserMessage[] {
  const claimed = this.mutate('next-step', 0, this.nextStep.length, [], false)
  if (target === 'next-turn') {
    claimed.push(...this.mutate('next-turn', 0, 1, [], false))
  }
  for (const message of claimed) this.notifications.claimed(message, turn)
  return claimed
}
```

**每次 claim 清空整个 `next-step` 队列，再至多弹一条 `next-turn`。** 由此三种输入 API 的语义全部确定：

| API | 入哪个队列 | 是否唤醒 idle driver | 消费边界 |
|---|---|---:|---|
| `followup()` | `next-turn` | 是 | 独占下一个 turn（FIFO，每个 prompt 一个 turn） |
| `steer()` | `next-step` | 是 | 运行中在最近 step 边界吃掉；idle 时也开 turn |
| `inject()` | `next-step` | **否** | 只排队，等别人唤醒（文件变更、skill 内容走这条路） |

注意 inbox 是 **durable 状态**：每次 splice 先 `session.append('agent/inbox/spliced')` 再改内存、最后发 live 通知（`mutate` 的三步顺序）——所以 resume 后待办输入还在。`claim` 被标 `@internal`："The agent loop's step-boundary operation, not a plugin extension point"——插件想影响输入只能走 `agent/pre-step` waterfall。

## 精读二：turn/step 状态机

`agent.ts` 的 `ReactLoopAgent` 是显式状态机（`idle | maintenance | running`）。追一遍主路径：

1. `send()` → inbox.splice → `wakeDriver()`；idle 时同步翻 `agent/status: running`。
2. `turn()` **先** `session.append('turn/start')` **再** claim inbox——顺序刻意：claim 产生的 splice 事件因此落在 turn 内（重启恢复时能区分"跑过的工作"与"丢弃的未跑工作"）。
3. 每个 step 由 `preStep()` 开场：跑 `agent/pre-step` waterfall——listener 可以 `reject`（turn 以 `blocked` 收尾、一个 step 都不开），也可以改写进入的 messages。通过后 `step/start` → 逐条 `user/message` → 进入 step。
4. step 内：`deriveMessages()` 现场投影历史（L04）→ `buildRequest()` 跑 `agent/request` waterfall、落 `request/header` → `llm/stream` → 每个 chunk 落 `assistant/chunk`、流结束落一条 `assistant/message` → 有工具调用进 `executeToolCalls`，没有则完成。
5. step 结束后问两个问题：工具欠不欠下一个请求？`next-step` 队列空不空？任一为真就开下一个 step。都否时跑 **`agent/turn-stopping`**（serial，没有 `next()`），然后 `turn/end`。

**取消的配平纪律**：`step/end` 在 `finally` 里落、`turn/end` 也在 `finally` 里落（`agent.ts` 里搜注释 "every exit assigns a turn ending"）。pre-step 之前取消则 step 根本不开（turn 仍闭合）；流中取消每个 chunk 后 `throwIfAborted`；工具已记 `tool/call` 未执行的补合成 `TOOL_ABORTED_BEFORE_DISPATCH` 结果（`tool-calls.ts` 的 `appendSkippedToolCall`）——**replay 对 provider 必须永远合法**。abort 窗口里到达的唤醒输入被 `wakingAfterAbort` 重分类到 `next-turn` 并 latch 到收敛后重放。

## 精读三：数据决定，不是监听顺序决定

`runtime-types.ts` 有一句设计纲领（原文搜 "Data decides"）：`agent/turn-stopping` 的 listener 想阻止停止，方式是 `steer()` 写数据，机器随后**重读 inbox 数据**决定续不续——"Data decides, so listener order cannot change the outcome"。工具提前结束 turn 也一样：结论写在 `ToolExecutionResult.concludesTurn` 数据里，不是回调里。把决定权收进数据，扩展点的执行顺序才不会变成隐藏的语义。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 时序图自检：合上 README，只看 docs/agent-lifecycle.md 复述完整 turn 事件序列
# 读取消配平的真实测试
grep -n "balances replay" packages/core/agent-loop/tests/cancel.spec.ts
# 找到 wakingAfterAbort 的测试证据
grep -rn "wakingAfterAbort\|reclassif" packages/core/agent-loop/tests/*.spec.ts | head -5
```

可选（需 `pnpm install`）：`pnpm vitest run packages/core/agent-loop --reporter=dot`。

## 设计思想

1. **两个队列胜过一个优先级队列**。`next-turn` 是"每个 prompt 独享一个 turn"的 FIFO，`next-step` 是"凑批进同一 step"的批队列——注入式上下文（不唤醒）与对话式输入（独占 turn）在类型上就分开，而不是靠优先级数字。
2. **配平纪律**：每个已开始的 turn/step 在所有路径（正常、取消、崩溃）上都有闭合事件；每个 `tool/call` 都有配对 `tool/result`。日志永远 provider-legal。
3. **数据决定论**：扩展点表达意愿的方式是写数据，机器重读数据裁决——监听顺序不可能改变结果。
4. **durable 状态先行**：inbox 的每次变更先入日志再改投影，重启后"欠着的输入"与"丢弃的工作"都有账可查。

## 证据边界

- 本课证明队列路由、边界配平与失败纪律的结构；不证明真实模型下的行为质量。
- `agent/*` 是 live 协调事件，不是回放数据——SDK 需要 replayable transcript 时应消费 `session/event`（L04/L10）。
