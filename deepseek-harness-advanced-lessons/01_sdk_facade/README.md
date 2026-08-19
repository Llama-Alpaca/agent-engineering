# L01：SDK Receipt、Notification 与活动区间

`session/prompt` 的 response 不是一轮 Agent 的最终结果。当前 wire 只返回已经排入 durable inbox 的 `messageId`；TypeScript/Python 高层 SDK 再从 notification stream 中找到对应 receipt，并收集到 root session 下一次 `idle` 为止。

## 活动区间

```text
subscribe tree -> session/prompt -> messageId
                    |             |
                    |      ignore unrelated/stale frames
                    v             v
             agent/inbox/spliced(messageId) -> ... -> root session idle
                     [        owned interval         ]
```

- 订阅必须先于 prompt，否则同步到达的 receipt 可能丢失。
- receipt 之前的 `idle` 不属于当前 prompt，不能提前结算。
- root session 的 event 进入 `RunResult.events`；child event 与 subagent lifecycle 仍进入 tree-level `notifications`。
- `finalResponse` 只从 owned interval 最后一条 root `assistant/message` 拼接 text block，不把 image 或旧会话文本伪装成答案。
- 当前 wire request 只有 `initialize`、`session/prompt`、`shutdown`，没有 per-prompt cancel 或 session-close。request timeout 表示客户端放弃等待，不等于远端 Agent 已取消。

## 运行

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/01_sdk_facade/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/01_sdk_facade/tests/run.ts
```

## 源码锚点

- `packages/sdk/protocol/src/types.ts`：`SessionPromptResult`、notification/request map
- `packages/sdk/server/src/server.ts`：lazy session creation、event/status/subagent forwarding
- `packages/sdk/client/src/client.ts`：`HarnessClient`、`NotificationSubscription`、timeout、stderr tail
- `packages/sdk/client/src/api.ts`：`DeepSeekHarness`、`HarnessSession.run`、receipt-to-idle interval
- `packages/sdk/client/src/dispose.ts`：EOF -> SIGTERM -> SIGKILL 回收梯子
- `python/sdk/` 与 `python/sdk-runtime/`：同一 wire contract 的 Python 表面

stdout 仍只属于协议；server 退出前要 flush response、dispose root，再结束进程。课程的进程回收函数是顺序模型，不宣称真的发送 OS signal。
