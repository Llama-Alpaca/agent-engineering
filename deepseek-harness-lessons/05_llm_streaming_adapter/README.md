# L05 LLM Runtime：流式协议与 Adapter

本课用一个 deterministic provider 复现 LLM runtime 的边界：`prepareCall()` 先把 route、model 和 adapter defaults 固化，随后 async generator 输出 text、reasoning、tool-call arguments、usage 和 finish chunks，`BlockAssembler` 只在合法 finish 后提交最终 assistant message。

## 运行

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 05
node --experimental-strip-types deepseek-harness-lessons/05_llm_streaming_adapter/tests/run.ts
```

不需要模型或 API key。脚本会运行五条路径：正常流、malformed chunk、一次 transient retry、context overflow 和中途取消。

## 关键不变量

- provider-neutral loop 只依赖 `LlmAdapter`；provider 路由和 model metadata 在 `prepareCall()` 校验。
- `BlockAssembler` 对 tool arguments 做增量拼接，JSON 解析和最终副作用延迟到 `commit()`。
- trailing usage 可以出现在 finish 前；没有 finish、未知 chunk 或非法 arguments 都是稳定的规范化错误。
- finish 是终止边界：其后任何 chunk 都会被协议层拒绝；即使回调在 finish 时取消，也不会提交 message 或工具调用。
- retry 复用相同 request id，但第一次失败没有 commit，因此不会重复产生 tool call。
- `AbortSignal` 取消会丢弃未提交 assembler；`committed: false` 比「看起来收到过几个 chunk」更重要。

源码阅读锚点（固定 commit `47f943859bef60e4160492346772ded9b24f765a`）：`packages/llm/llm/src/index.ts`、`packages/llm/llm/src/types.ts`、`packages/llm/llm/src/assembler.ts`、`packages/llm/llm-deepseek/src/adapter.ts`、`serialize.ts`、`sse.ts`、`translate.ts`。

## 证据边界

这里的 chunk schema 是课程 fixture，不是对上游未来 provider API 的承诺；它用来演示 adapter 的职责和错误边界。真实 SSE、网络重试、token 计量和模型行为仍需在固定上游 checkout 与显式 real-API smoke 中验证。
