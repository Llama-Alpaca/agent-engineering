# A03：组合的事务性——Preset、Standing Mount 与 Recompose

> 决策案例：一个会话想换一套工具组合（preset）。最直觉的做法是"卸载旧的、加载新的"——但会话日志里已经记录了旧组合下发出的工具调用。上游的选择：**已经在产出的会话不允许换组合**，把这条限制连同理由写进了源码注释。

## 阅读地图

1. `packages/preset/agent-presets/README.md` —— preset 的定位与信任模型
2. `packages/preset/agent-presets/src/preset.ts` —— id 即遏制边界
3. `packages/preset/agent-presets/src/index.ts` —— standing mount、generation、recompose（本课主菜）
4. `packages/preset/agent-presets/src/mount.ts` —— 挂载审计与回滚

## 案例一：standing mount——挂一次，join 多次

最朴素的设计是"每个会话实例化一次 preset 插件树"。上游否了它：roster（名册服务）**每进程只挂载一次** preset（standing mount，归 roster 自己的 fiber），会话通过 `dsh-scope` 父链 join（`agentPresets.mount` → `bindScopeParent`）。理由：多个会话共享同一代组合，才不会出现"同一 preset 名字、两套行为"。

**generation（代）**由 preset 目录的文件 stamp（mtimeMs + size）驱动：下次有会话要用这个 preset 时 stamp 不一致就开新一代；已 join 的会话保持旧代直到进程结束。子代理继承用同步的 `composeFrom` 而不是重读 roster——按名字重新 resolve 会拿到"文件被编辑后的另一代"，与父代不一致。

## 案例二：recompose——只许在"一无产出"时换

`index.ts` 的 `recompose` 带着本课最重要的一句注释（原文搜 "swapping tools mid"）：

> swapping tools mid conversation would leave logged tool calls the new composition cannot make

日志里记着旧组合的工具调用；新组合里那些工具可能不存在了。允许中途换，resume/replay 就会出现"日志引用了当前组合无法解释的调用"。所以规则是：**只有还没产出任何东西的 agent 才能换 preset**。换的动作本身是事务：先确保新 standing mount 成功，再移动 scope 父链接；失败则保持原状（"there is no torn-down state to restore"——没有拆卸就没有恢复）。

## 案例三：挂载审计——把"半组合"定义为不可能状态

`mount.ts` 的 `mountPreset` 在 `PresetTree`（extends Include）挂载后做两项审计，任一失败整棵子树回滚并抛 `PresetMountError`：

- **inactiveRows**：还有行在等服务 → 拒绝（半死不活的组合不许用）；
- **leakedServices**：有服务发布进了 ROOT realm → 拒绝（那会是进程全局的，第二个会话会撞上第一个）。

注释原文："A rejection leaves nothing mounted"。两个防御性覆写也很讲究：`PresetTree.import` 让裸包名从 harness 自身的 baseUrl 解析（用户家目录向上走不到 harness 的 node_modules）；`PresetTree.write()` 被置空——"a preset is an input, never a persistence target"（否则 Loader 会在会话结束时把发行组合文件截断成 `[]`）。

配套的诚实细节：id 规则 `PRESET_ID` 的注释说它是 "containment boundary rather than a style rule"——id 会成为路径段，`..` 或绝对路径样式会越出 preset 目录；`trust: 'user'` 的 preset "carries the same trust as shell access"。选择事件 `agent-preset/selected` 是 log-only 的 durable 事件，恢复时倒序找最新选择——"model-visible ⟺ logged" 的又一次兑现。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
# 三句决策原话
grep -n "swapping tools mid" packages/preset/agent-presets/src/index.ts
grep -n "A rejection leaves nothing mounted" packages/preset/agent-presets/src/mount.ts
grep -n "containment boundary rather than" packages/preset/agent-presets/src/preset.ts
# 审计的实现
grep -n "inactiveRows\|leakedServices" packages/preset/agent-presets/src/mount.ts | head
# write() 置空的理由
grep -n "never a persistence target" -B2 -A4 packages/preset/agent-presets/src/mount.ts
```

## 设计思想

1. **日志约束 API 的形状**：哪些操作允许，由"日志还能不能重放与解释"反推——recompose 的限制不是产品偏 好，是事件溯源的数学后果。
2. **事务的两种形态**：创建即事务（挂载失败整树回滚，没有半组合状态）；交换即重挂（父链接 rebind，不经过"先拆后装"的中间态）。
3. **共享要跨代一致**：standing mount + generation 让"同名 preset"在全进程内是同一个对象；代际切换只影响新会话。
4. **id 是安全边界不是风格**：命名规则的理由写成注释，防止后人"放松"成 cosmetic 校验。

## 证据边界

- 被淘汰的旧代 standing mount 不 dispose（快照留有 TODO：skill-filesystem 还在 watch 旧子树）——这是已知未完成项，不是设计。
- preset 的 authoring 面（复制/删除目录）不在本课范围。
