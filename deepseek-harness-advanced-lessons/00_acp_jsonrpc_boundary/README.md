# L00：ACP Rich Content 与 JSON-RPC 边界

同一个 Agent Loop 被两类协议消费，但两者的结算语义并不相同。本课先复现 SDK 使用的 newline-delimited JSON-RPC transport，再沿 ACP 的 `initialize -> newSession -> prompt -> cancel` 路径研究 rich-content admission。

## 当前快照事实

- `JsonRpcLineTransport` 把每行作为一帧；语法错误和畸形 peer frame 被忽略，缺少 request handler 返回 `-32601`，handler 抛错返回 `-32603`，notification 永远没有 response。
- SDK runtime 的 stdout 只能承载 JSON-RPC frame；诊断必须写 stderr。
- ACP 初始化只有在 attachment store、部署媒体类型和精确模型路由都支持图像时，才声明 image prompt capability。
- `admitAcpPrompt()` 先验证完整 block 列表，再批量持久化图片；MIME 只接受 PNG/JPEG/WebP/GIF，base64 必须是 RFC 4648 canonical form。
- 取消可能发生在图片写入之后。此时允许留下不可达的 content-addressed object，但不能把一条晚到的 user message 放进 inbox。
- prompt 要等 admission、Agent quiescence 和已排队的输出 delivery 都结束后才结算；teardown 先取消 parent，再 drain 可继续的 child。

## 运行

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/00_acp_jsonrpc_boundary/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/00_acp_jsonrpc_boundary/tests/run.ts
```

实验实现的是这些边界的确定性小模型，不重新实现 `@agentclientprotocol/sdk`。特别注意：畸形 JSON-RPC 行被忽略是当前上游 transport 的事实，不要用通用 JSON-RPC 教材里的 `-32700` 覆盖源码行为。

## 源码锚点

- `packages/sdk/protocol/src/transport.ts`：`JsonRpcLineTransport`、`JsonRpcResponseError`
- `packages/acp/acp/src/index.ts`：`SessionRecord`、`settleAfterQuiescence`、`makeAgent.prompt`、`makeAgent.cancel`
- `packages/acp/acp/src/content.ts`：`supportsAcpImagePrompts`、`admitAcpPrompt`、`assistantBlockToAcp`
- `packages/acp/acp/tests/{turns,content,dispose,edges}.spec.ts`：结算、内容、teardown 与竞态证据
