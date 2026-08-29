# A03 练习：源码作业

## 1. 追踪题：join 的完整路径

从 `agentPresets.mount()` 到 `bindScopeParent(agentKey, standing.key)`，列出每一步。回答：为什么 join 发生在 agent factory 的 `setup(agentCtx)` 里而不是会话第一个 turn 时？（提示：a rejected composition rolls the whole creation back——创建即事务。）

## 2. 阅读题：generation 的边界情况

读 `ensureStanding` 的 stamp 逻辑。回答：(a) 文件只在会话运行中被 touch（内容没变）会发生什么？(b) 旧代为什么不 dispose（找到 TODO 注释）？(c) 进程重启后 generation 从哪恢复？

## 3. 思考题：给 recompose 松绑

假设产品要求"会话中途允许换 preset，只要新旧组合的工具名集合是超集关系"。写 150 字分析：这个规则够不够？哪个日志场景仍然会坏（提示：工具同名但 schema 变了；`request/header` 里固化的 tool 顺序）？

## 4. 阅读题：两项审计各自防什么

`inactiveRows` 与 `leakedServices` 的拒绝理由各是什么？把"第二个会话撞上第一个"的具体机制写出来（ROOT realm 的服务对全会话可见）。任一审计失败后的回滚为什么是 `handle.dispose()` 而不是"清理泄漏的服务"？

## 5. 对比题：与课程十二 L02 的组合事务

`EntryGroup.update`（boot 层）与 `mountPreset`（preset 层）都是"组合即事务"。对比两者：diff 粒度、回滚方式、审计内容。回答：为什么 preset 层需要额外的 leakedServices 审计而 boot 层不需要（提示：boot 的树本来就在 root realm）？

## 6. 设计反思题

你的系统里有没有"运行中换配置/换插件"的功能？它有没有"日志已引用旧配置"的问题？用本课的规则（创建即事务、交换即重挂、日志约束 API）写三条改法。
