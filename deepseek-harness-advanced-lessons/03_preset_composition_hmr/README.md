# L03：Preset、Standing Mount 与事务式 Recompose

Agent preset 不是“每开一个 session 就再加载一遍插件”。当前上游为每个 preset 建一个 standing mount，多个 agent scope 通过 parent binding 加入同一 composition。插件实例、工具注册、prompt section 和 projection unit 只挂一次，插件内部再按 session 隔离状态。

## Generation 规则

- `list()` / `resolve()` 每次重新扫描 roots，较早 root 对重复 id 胜出；坏 YAML、缺 composition、未激活 row 会在挂载前暴露。
- 同一 stamp 的首次挂载 single-flight；后续 session 复用相同 standing mount。
- composition 文件 stamp 改变后，新 session 获得新 generation；已经加入的 session 继续使用旧 generation，旧 mount 在进程整体 teardown 前不会销毁。
- child 用 `composeFrom()` 加入 parent 的精确 generation，不按 preset id 重新扫描。否则编辑或删除源文件会让 parent/child 使用不同世界。
- `recompose()` 只允许空 session；目标 preset 成功解析并挂载后才切换 scope binding，失败保留原 composition。
- preset row 直接向 root 发布 process-global service 会被 `leakedServices()` 拒绝。

## Authoring 边界

浏览器 authoring 只接受“从已有 preset 整目录复制”，不接受任意 composition text。id 必须匹配安全目录名；system preset 不可删除。删除一个 live session 已使用的 user preset 不影响该 session，因为它已经绑定到读入的 standing generation。

## 运行

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/03_preset_composition_hmr/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/03_preset_composition_hmr/tests/run.ts
```

源码从 `packages/preset/agent-presets/src/{index,mount,discovery,authoring}.ts` 开始，重点看 `AgentPresets.mount/composeFrom/recompose`、`standingMountFor`、`serviceForAgent`、`inactiveRows` 和 `leakedServices`。本课用内存 catalog 模拟文件系统，不声称复制了 Cordis Loader。
