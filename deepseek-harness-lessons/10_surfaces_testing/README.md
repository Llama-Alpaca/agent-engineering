# L10：产品表面与证据分层——headless、ACP、SDK、Python

> 本课问题：同一条 Agent spine 怎样成为四个产品？各自的边界证据是什么？

`ctx.agents` 是唯一的 agent 工厂；四个表面全部是它之上的**薄适配**，没有一个自己写循环。三个表面的源码里有同一段注释（各自声明"不做 preset 组合"）——同一个决策在三处复述：模型侧行留在 host 平面。

## 阅读地图

1. `packages/bundle/headless/src/index.ts` —— 最小表面：先看它
2. `packages/sdk/protocol/src/transport.ts` —— NDJSON 传输
3. `packages/sdk/server/src/server.ts` + `packages/sdk/client/src/api.ts` —— receipt 闭环
4. `packages/acp/acp/src/index.ts` —— ACP 适配
5. `python/sdk/src/deepseek_harness/api.py` —— 第二语言镜像
6. `docs/testing.md` —— 五条测试 lane

## 精读一：headless——活动区间的最小实现

headless runner 的全部智慧在"怎么算这次任务的事件区间"：记 `firstSeq = agent.session.seq`，`followup` 后 `await agent.whenIdle()`，然后 `summarize(events, firstSeq)` 只取区间内事件，打印末条 assistant 文本，按 turn 结局决定退出码。**区间 = 日志 seq 切片**——没有第二套"本次任务状态"，日志就是区间。

## 精读二：SDK——receipt，不是结果

`server.ts` 的 `prompt()` 方法注释就是设计宣言：

```ts
/**
 * Queue one identified prompt without assigning later activity to it.
 */
async prompt(params: SessionPromptParams): Promise<SessionPromptResult> {
  ...
  rec.handle.agent.followup(message)
  return { messageId: message.id }
}
```

**服务器拒绝替客户端归因"接下来的活动属于哪次 prompt"**。归因移到客户端，且用的就是持久日志本身（`client/src/api.ts`）：

- 区间左端点：等 `agent/inbox/spliced` 事件里出现 `inserted[].id === messageId`（`isInboxReceipt`）——消息**真正落入持久 inbox** 的那一刻，而不是 RPC 返回的那一刻；
- 区间右端点：`session.status: idle`——whole-agent 静默，不是单 turn 结束。

服务器广播所有会话的通知，作用域裁剪全部在客户端做（`subscribeSessionTree` 现场累积 subagent 族谱）。Python 客户端逐行镜像同一循环（`api.py` 的 `_is_inbox_receipt`）——两个语言、一份协议，`docs/testing.md` 因此规定改 agent loop 必须同时更新两侧 snapshot。

传输层（`transport.ts` 的 `JsonRpcLineTransport`）三条事实：NDJSON framing，**畸形行直接忽略**（注意：这是当前上游的选择，不要拿通用 JSON-RPC 教材的 `-32700` 覆盖源码事实）；缺 handler 回 `-32601`、handler 抛错回 `-32603`；notification 永远没有响应。客户端契约同样诚实："There is no wire-level cancel: a timed-out request stays running server-side"。

## 精读三：ACP——admission 与结算

ACP（`acp/src/index.ts`，rc.5 快照）把 prompt 的 admission 做成带取消围栏的事务：图片整批校验通过才落盘；取消检查与 `followup` 之间不允许任何 await（rc.5 注释 "the prompt settles only when the agent stops"——结算等到 whole-agent idle 与输出排空，所以一次 cancel 不会误杀无关的自主工作）。stdout 只承载协议帧、诊断走 stderr——协议纯度由组合保证。课程十三 L00 会用 rc.7 的完整版（`content.ts` 的 `admitAcpPrompt`）做案例精读。

## 精读四：五条测试 lane

`docs/testing.md` 的分层（配合根 `package.json` scripts 与 CI workflow 阅读）：

| lane | 内容 | CI 态度 |
|---|---|---|
| unit + coverage | per-file 100% 覆盖门 | 必跑 |
| keyless snapshot / real-composition | 从构建产物启动真实示例进程回放 | 必跑；CI 强制 replay 只读 |
| real-API e2e | 真模型 | 有 key 才跑；"We are DeepSeek — **do not ration real-API tests**" |
| browser snapshot | Web UI 回放 | Linux PR 必跑 |
| python lane | SDK 3.10 keyless | 必跑 |

注意态度的分寸：离线 lane 保证"没 key 也全绿"，但**从不假装**能替代真 API——两者结论分栏，不混报。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# receipt 闭环：server 返回什么、client 等什么
grep -n "messageId\|without assigning" packages/sdk/server/src/server.ts | head -5
grep -n "isInboxReceipt\|session.status" packages/sdk/client/src/api.ts | head -5
# Python 镜像
grep -n "_is_inbox_receipt" python/sdk/src/deepseek_harness/api.py
# 传输层三事实
grep -n "32601\|32603\|malformed" packages/sdk/protocol/src/transport.ts | head
```

## 设计思想

1. **Receipt, not result**：RPC 只回"收到什么"（messageId），"发生了什么"由消费者在持久事件流里按收据划定区间——归因走日志，服务器永不猜测。
2. **协议面只留 committed 语义**：ACP 只转发 committed `assistant/message`，原始 chunk/推理/工具过程全部留在展示层；stdout 专用于帧。
3. **双客户端互为契约十字检查**：TS 与 Python 独立投影同一协议，改动必须同时过两侧 snapshot——协议漂移在 CI 就暴露。
4. **测试分层诚实**：keyless 与 real-API 的结论分栏；离线全绿从不被用来宣称真实模型可用。

## 证据边界

- 本快照（rc.5）的 ACP admission 尚未拆出 `content.ts`（rc.7 的形态）；课程十三 L00 讲演进后的版本。
- "畸形行忽略"是当前 `JsonRpcLineTransport` 的事实，不是 JSON-RPC 规范要求——读源码事实，不读教材想象。
