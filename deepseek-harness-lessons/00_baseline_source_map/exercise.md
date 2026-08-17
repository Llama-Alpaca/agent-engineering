# L00 练习

## 练习 1：锁漂移为何必须失败

在 `runFailureChecks()` 中把 `drifted` 的 SHA 改成只改一位的值，运行课件。确认错误发生在启动早期，而不是等到读源码时才暴露。再把 `manifest.commit` 改成另一个值，观察第二道校验。

## 练习 2：拆分 durable 与 live

给 replay 增加一个 `live` 事件，然后实现 `replayDurableOnly(events)`，只接受 `data.stream === "durable"` 的记录。回答：为什么 `agent/status=idle` 丢失时，仍然可以从 `turn/end` 推断会话已经配平？

## 练习 3：扩展 chunk union

新增一个 `tool-call` chunk variant，并让 `consumeScriptedStream()` 在遇到它时只记录名字、不执行工具。思考：为什么 LLM stream 的解析和工具执行要分成两个边界？

完成标准：重复运行输出逐字节一致；任何已开始的 turn/step 都有对应结束事件；错误输入不会被静默接受。
