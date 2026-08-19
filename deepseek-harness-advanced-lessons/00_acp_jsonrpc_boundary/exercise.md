# L00 练习

1. 给 NDJSON peer 加一个 pending request 表和 `AbortSignal`。证明 abort 只删除本地 waiter，不伪造远端 prompt 已取消。
2. 注入第二张非法图片，证明第一张也不会写入 store；再让取消发生在 batch 保存后，证明 object 可以存在但 inbox 仍为空。
3. 增加 assistant text/image/text 投影，故意让图片读取失败，检查 prompt 不能在 output tail 报错前错误地返回成功。
4. 模拟 teardown：parent prompt 正在输出、child 可继续。记录“取消 parent -> 等输出 -> drain child -> dispose session”的顺序。

完成标准：能解释 transport error、content admission error、durable inbox receipt 和 prompt stop reason 分别属于哪一层；任何失败测试都不能靠向协议 stdout 写日志通过。
