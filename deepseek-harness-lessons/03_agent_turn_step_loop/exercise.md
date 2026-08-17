# L03 练习

## 练习 1：验证 wake 语义

新建 Agent 后只调用 `inject()`，立即检查 `status`：它应保持 `idle`。随后调用 `steer()`，两个 next-step 消息应在同一 turn 的第一个 step 被 claim。把 `steer()` 换成 `followup()`，比较消息次序：claim 总是先取全部 next-step，再取一条 next-turn。

## 练习 2：给 trace 做配平检查

在 `assertBalancedAgent()` 中故意跳过一次 `step/end`，确认测试失败。再增加以下不变量：每个 `assistant/message` 必须位于一个开放 step 内；每个 `tool/result` 必须与同一 turn/step 的 call 对齐。

## 练习 3：取消时保留 Inbox

将 `cancel(point)` 改成 `cancel(point, true)`，在取消前排入一个 followup。观察当前 turn 结束后这条输入是否还在队列。回答：为什么“保留待办”和“立即启动替代 driver”需要分开建模？

## 练习 4：Fiber 卸载

在 streaming hook 外部调用 `dispose()`，等待 `whenIdle()`。验收顺序应为：当前 step/end、turn/end、`agent/status=idle`、`agent/disposed`，且 disposal 后发送消息响亮失败。
