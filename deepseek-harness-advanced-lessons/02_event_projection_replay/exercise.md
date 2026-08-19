# L02 练习

1. 让 seq 12 的 push 先到、seq 10 的 baseline 后到，分别验证同 key 不回退、baseline 省略也不清除新值。
2. 模拟 host 重启：客户端保留 seq 100 title，订阅握手只确认 durable seq 80。先不 truncate 观察错误，再修复。
3. 给 conversation window 前插三页重复边界，证明节点不重复、既有节点 reference 不变、`hasMore` 正确收束。
4. 构造 orphan lineage 和闭环 lineage，要求所有 session 都显示且不会递归溢出。
5. 构造 257 层 tool-call 链和一个反向边，证明坏 edge 被消费但同 session 其他内容仍可渲染。

完成标准：能区分“host projection 的 watermark”和“conversation event window 的 seq”，并解释为什么两者不能共用一个随意的最后写入规则。
