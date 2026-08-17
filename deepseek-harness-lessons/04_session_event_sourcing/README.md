# L04 Session 事件溯源：log、surface、replay、resume、fork

本课把「对话历史」拆成三个不同对象：不可变的 append-only session log、面向 UI/模型的 surface projection，以及由投影重建的 `deriveMessages()`。这正对应 DeepSeek Harness 快照中的 `SessionEventMap`、`surface` 和 persistence 包，而不是把所有内容塞进一个可变消息数组。

## 运行

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 04
node --experimental-strip-types deepseek-harness-lessons/04_session_event_sourcing/tests/run.ts
```

实验不联网、不读取 API key。程序输出一份 JSON trace，包含一次压缩替换、JSONL resume、fork 和一个故意失败的 reconstruction invariant。

## 观察重点

- `EventLog.append()` 使用从 0 开始的连续 `seq`，只追加新事件；`snapshot()`、JSONL 和 fork 都复制数据，不能原地修改 parent。
- replacement 是一个普通的 surface 消息事件，携带 `surfaceOp: { op: "replace", start, end }` 和完整 `sourceEventSeqs`；它隐藏旧 surface 节点，但原始事件仍留在 log。
- `request/header` 的 `data.header` 固定 provider、model、system prompt、tool schema 名称和 adapter defaults；它不是一条 `request/reconstruct` 事件。
- `assertRequestReconstructable()` 在给定 durable prefix 上比较 header 的 `visibleMessageIds`、请求消息 ID 和内容，检测「模型看到了但没有记录」的上下文。
- fork 的边界是 inclusive：child 复制 `seq <= boundary` 的前缀，后续追加不会污染 parent；这与「从某个 durable event 创建新 lineage」比共享一个数组更容易审计。

源码阅读锚点（固定 commit `47f943859bef60e4160492346772ded9b24f765a`）：`packages/core/session/src/types.ts`、`packages/core/session/src/index.ts`、`packages/core/session/src/surface.ts`、`packages/session/session-persistence*/`。

## 证据边界

这里验证的是事件溯源不变量和投影语义，不声称复制了上游全部事件种类或 persistence backend。真实上游的 event 名称、surface 细节和 rc API 可能漂移；升级时应先核对 `source-manifest.json` 和固定 SHA。
