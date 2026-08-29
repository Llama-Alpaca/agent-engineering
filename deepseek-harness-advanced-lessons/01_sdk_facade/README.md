# A01：归因的设计——Receipt 而非结果

> 决策案例：SDK 的 `session/prompt` 完全有能力"等这轮跑完再返回结果"——为什么它坚持只返回一个 `messageId`，把"这次调用发生了什么"的问题推给客户端？

## 阅读地图

1. `packages/sdk/protocol/src/types.ts` —— `SessionPromptResult` 的类型注释
2. `packages/sdk/server/src/server.ts` —— receipt 的服务端
3. `packages/sdk/client/src/api.ts` + `client.ts` —— 归因的客户端
4. `python/sdk/src/deepseek_harness/api.py` —— 同一决策的第二语言镜像

## 案例：服务器拒绝归因

服务端全部代码（`server.ts`）：

```ts
/**
 * Queue one identified prompt without assigning later activity to it.
 */
async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
  const rec = await this.getOrCreateSession(params.sessionId)
  const message = createUserMessage({ content: params.contentBlocks, source: { kind: 'user' } })
  rec.handle.agent.followup(message)
  return { messageId: message.id }
}
```

方法注释就是决策宣言：**"不把后续活动归因给它"**。如果服务器等结果：等多久算完（一个 turn？whole-agent idle？后台 job？）；两个并发 prompt 的活动怎么分账；客户端断线期间的结果丢给谁。所有这些问题在"服务器返回结果"的模型下都无解，在"客户端拿收据自己归因"的模型下都有明确答案：

- **左端点 = inbox 收据**：客户端在 `session.event` 流里等 `agent/inbox/spliced` 事件且 `inserted[].id === messageId`（`api.ts` 的 `isInboxReceipt`）——消息**真正落入持久 inbox** 的那一刻，不是 RPC 返回的那一刻。两者之间可能隔着 admission、图片落盘与排队；
- **右端点 = whole-agent idle**：`session.status: idle`，不是"一个 turn 结束"——模型可能连续跑多个 turn，后台还有 subagent。

**归因用的材料就是持久日志本身**。没有第二套"本次调用状态"——收据是日志事件，区间端点是日志事件，中间的活动也是日志事件。这是课程十二 L04"单一真相 + 投影"在 API 边界的兑现：**API 服务器也是日志的一个消费者，不是真相的另一个持有者**。

三个配套决策值得在源码里确认：

1. **服务器广播、客户端裁剪**：所有会话的通知全部广播，作用域（包括 subagent 族谱）由客户端 `subscribeSessionTree` 现场累积——服务器不知道也不需要知道每个客户端关心什么；
2. **诚实的无取消契约**：`client.ts` 类注释明说 "wire-level cancel: a timed-out request stays running server-side until the runtime is closed"——超时是客户端的事，服务器不会替你杀工作；
3. **双语言十字检查**：`api.py` 的 `_is_inbox_receipt` 与 TS 侧逐行同构；`docs/testing.md` 因此规定改 agent loop 必须同时更新两侧 snapshot。协议不是文档，是两份独立实现必须同时满足的约束。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
# 决策宣言与类型
grep -n "without assigning" packages/sdk/server/src/server.ts
grep -n "Durable enqueue receipt" packages/sdk/protocol/src/types.ts
# 客户端归因循环
sed -n '/while (true)/,/^  }/p' packages/sdk/client/src/api.ts | head -20
# Python 镜像
grep -n "_is_inbox_receipt" -A 6 python/sdk/src/deepseek_harness/api.py
```

## 设计思想

1. **Receipt, not result**：分布式边界上，"收到什么"（同步可答）与"发生了什么"（需要区间与归因）是两个问题；只回答第一个，把第二个交给持有日志的消费者。
2. **归因端点必须是持久事实**：inbox 收据与 idle 信号都来自日志，而不是服务器内存里的"当前请求"指针——客户端重连、换进程、换语言都能重建同样的归因。
3. **不提供的能力也要诚实声明**：wire-level cancel 不存在这件事写在类注释里，而不是留给用户在事故里发现。
4. **协议由两份独立实现共同约束**：TS 与 Python 客户端是彼此的合规测试。

## 证据边界

- 引用对 `99f6f02` 负责；receipt 词汇与 notification 集随上游演进可能扩展。
- 本课证明归因机制的结构，不评价长轮询 vs 流式推送的传输效率取舍。
