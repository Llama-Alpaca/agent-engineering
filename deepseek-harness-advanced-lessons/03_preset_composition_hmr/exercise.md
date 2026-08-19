# L03 练习

1. 并发创建两个首次使用 `standard` 的 session，加入 single-flight gate，证明只产生一个 generation。
2. 修改 preset stamp，再创建新 session 和旧 parent 的 child：前者应进新 generation，后者必须留在旧 generation。
3. 让新 generation 的一个 row 挂载失败，证明旧 session、旧 listener 和旧 service identity 全部不变。
4. 删除 live session 正在使用的 user preset，再让它派生 child；child 仍应加入 parent 的 standing mount，而按 id 新建 session 必须报 unknown。
5. 模拟 composition 向 root 泄漏 service，确认挂载在 agent 发布之前失败，不能产生半组合 session。

完成标准：能解释为什么 standing mount 既不是 process-global composition，也不是 per-session plugin tree，并能区分“文件热更新影响未来 session”和“recompose 当前空 session”。
