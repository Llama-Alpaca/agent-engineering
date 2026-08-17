# L08 练习

## 概念题

1. 为什么 `syntheticCanonicalBytes` 可以保持不变，而 `modelVisibleTokens` 下降？分别指出本课 synthetic canonical、view 和 spill copy 的所有者，并解释为什么前者不能当作上游 durable event 的原始字节数。
2. `spill` 和 `compaction` 都能省 token，它们在可追溯性和语义损失上的取舍有什么不同？
3. 如果把全局 skill 目录无条件写进每个请求的 user-role catalog，会产生哪两个 scope 隔离问题？skill 正文应在什么时机进入上下文？

## 改码题

1. 给 `SpillStore` 增加 `delete(locator)` 和 TTL 事件；测试过期后 locator 读取失败，但审计事件仍保留。
2. 把 `estimateTokens()` 替换成按空格计数的 meter，比较五个策略的相对排序是否改变。不要把这个替身的绝对值当成模型 tokenizer 结论。
3. 给 `compactHistory()` 增加最大摘要长度；当事实行装不下时显式抛错，而不是静默丢弃事实。

## 失败注入

1. 在 `spillToolResult()` 中故意 `store.put(view)`，为测试增加断言，证明这是破坏 canonical value 的错误实现。
2. 在 `AgentContextScope.dispose()` 中注释掉 `localSkills.clear()`，观察 disposer 断言如何发现 skill 泄漏。
3. 把 `combined` 的 compaction budget 调到 1，设计一个 fail-closed 错误，避免输出看似成功但没有事实的摘要。

## 设计实验

为一个 100 MB 的代码搜索结果设计 durable spill 格式：模型只看到哪些字段？locator 如何授权、过期和审计？写出至少三条不会被本课 mock 覆盖的生产风险。
