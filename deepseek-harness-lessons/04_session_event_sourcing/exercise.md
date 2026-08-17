# L04 练习

1. 在给定 `atSeq` 上构造一个 header，故意把 `visibleMessageIds` 改成 `ghost`，确认重建在 header 对齐处失败。
2. 为一个新的 `assistant/message` 携带 `surfaceOp.replace`，只替换一个 tool result，并比较 raw log、surface 节点和 transcript。
3. 为 fork 增加 `lineage` 检查：child 必须保留 parent id 和 inclusive 边界，但 child 的新事件序号必须从 prefix 长度继续。
4. 写一个负例：保留正确 header，却把未记录的消息放进 `visibleMessages`；错误应在内容/长度比对处失败，而不是静默接受。

## 验收

- `node --experimental-strip-types code.ts` 输出 `ok: true`。
- `tests/run.ts` 的断言全部通过。
- 能解释为什么「raw log、surface projection、model request」不能互相替代。
