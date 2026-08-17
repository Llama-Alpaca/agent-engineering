# L03：Agent Registry、Inbox 与 Turn / Step Loop

一条用户消息不是直接调用一次模型。固定快照把接口和默认实现拆开：

- `packages/core/agent/src/inbox.ts`：durable `next-turn` / `next-step` 投影；
- `packages/core/agent/src/index.ts`：Agent registry 与 live handle；
- `packages/core/agent-loop/src/agent.ts`：`ReactLoopAgent` 的 turn/step driver；
- `docs/agent-lifecycle.md`：durable session events 与 live Cordis events 的对齐图。

## 三种输入语义

| API | Inbox target | 是否唤醒 idle driver | 消费边界 |
|---|---|---:|---|
| `followup()` | `next-turn` | 是 | 独立的下一 turn |
| `steer()` | `next-step` | 是 | 运行中最近的下一 step；idle 时也开 turn |
| `inject()` | `next-step` | 否 | 只排队，等 followup/steer 或当前 loop 的下一 step |

这是本课按锁定 SHA 核对过的上游契约，不是课程自行命名。`code.ts` 用 scripted LLM 重建同样的队列和边界，但不导入上游 package。

## 两条时间线

durable 线记录 `turn/start`、`step/start`、`request/header`、`assistant/*`、`tool/call`、`tool/result`、`step/end`、`turn/end`；live 线记录 `agent/status`、`agent/pre-step`、`agent/request` 与 `tools/*` pipeline。SDK 若要 replay transcript，应消费 durable `session/event`，不能只保存 live 通知。

正常场景会完成一个 tool step、一个汇总 step 和后续 turn。三个失败场景分别在 pre-step、streaming、tool dispatch 取消：

- pre-step 取消只配平 turn，因为 step 尚未开始；
- stream 取消配平已经开始的 step 和 turn；
- tool 取消还为已经记录的 `tool/call` 写入稳定的 aborted `tool/result`。

## 跑实验

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 03
node --experimental-strip-types deepseek-harness-lessons/03_agent_turn_step_loop/tests/loop.test.ts
```

输出给每条事件加 `scenario` 标签，四种路径可逐项过滤；重复运行确定，不需要 API Key。

## 证据边界

离线 loop 省略了真实 BlockAssembler、provider retry、并行工具调度、Session persistence 与 agent scope。它证明的是队列路由、边界配平和失败纪律，不证明真实模型或上游完整组合已经运行成功。
