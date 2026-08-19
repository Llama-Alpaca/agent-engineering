# L02：Host Projection、Replay 与长列表

当前 Web runtime 并不是让每个 React 组件重放完整业务日志。上游把两类问题拆开：host 计算完成的 whole-value projection 通过 `session/projection` 推送；conversation assembler 则在客户端维护当前连续事件窗口和节点 identity。

## 两条数据路径

| 路径 | 核心规则 | 解决的问题 |
|---|---|---|
| projection value | `key -> { value, seq }`，higher seq wins | title、usage、permission 等整值能力 |
| conversation window | replace / append / prepend，按 seq 组装 context | 消息、工具卡、分页历史、增量 UI |

projection baseline 代表一个 consistent cut。它携带的 key 按同一个 seq 规则落地；省略的 key 表示该 cut 上能力不存在，但不能清除已经由更高 seq push 到达的值。host 重启后若 durable `lastSeq` 低于本地 row，还必须 `truncate()`，否则“未来值”会永久压过重算结果。

conversation 的旧页前插不能重建所有节点对象，否则展开态、selector cache 和 React identity 都会抖动。递归工具树还要拒绝 cycle，并在上游固定深度 256 处停止恶意/损坏历史。

## 运行

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/02_event_projection_replay/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/02_event_projection_replay/tests/run.ts
```

## 源码锚点

- `projection-store.ts`：`ProjectionValueStore.apply/seed/truncate`
- `conversation-assembler.ts`：`replaceWindow/append/prepend`、dependency replay
- `lineage.ts`：orphan 降级、cycle fail-soft、输入顺序权威
- `tool-call-tree.ts`：child pairing、结构共享、cycle/depth guard
- `apiproxy/src/api/sessions.ts`：history page 与 projection consistent cut
- Web `replay-round-trip`、`stats-paged-history`、`trajectory-virtualization` E2E：真实产品证据

本课的 assembler 是缩小模型，不覆盖上游 registry-driven context/view 定义；它只验证 watermark、分页与 identity 不变量。
