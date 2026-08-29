# L10 练习：源码作业

## 1. 追踪题：一次 prompt 的完整闭环

从 `client.prompt()` 到拿到最终回复，按时序列出：RPC 返回了什么、客户端接下来等哪两个信号、各在哪个文件哪一行判定。回答：如果客户端把"RPC 返回"当作区间左端点而不是 inbox 收据，会多算进什么、少算进什么？

## 2. 阅读题：传输层的三个边界

`transport.ts` 里找到：(a) `JSON.parse` 失败的处理；(b) 无 handler 的 request 的错误码；(c) notification 为什么没有响应。然后回答：这个实现与 JSON-RPC 规范的 `-32700` 在哪里分歧？课程为什么要强调"读源码事实，不读教材想象"？

## 3. 对比题：headless vs ACP vs SDK 的区间

三个表面各自怎么界定"这次任务的活动区间"？（headless 的 seq 切片、ACP 的 admission→quiescence→输出排空、SDK 的 receipt→idle。）回答：为什么没有一个表面用"turn 数"或"固定超时"做区间？

## 4. 阅读题：三处同一段注释

在 headless、ACP、SDK server 三处源码里找到"不做 preset 组合"的声明（提示：搜 preset）。为什么模型侧组合必须留在 host 平面、由 factory setup 做？如果一个 SDK 客户端自己挂 preset，会破坏哪条不变量？

## 5. 实验题：跑一条 keyless lane

可选（需 `pnpm install && pnpm run build`）：在快照里跑 `pnpm run test:snapshot` 或其中某个示例的回放（按 `docs/testing.md` 的指引）。记录：这条 lane 启动了什么真实进程、回放了什么 fixture、断言了什么。如果环境不允许，改为精读 `docs/testing.md` 的 Tiers 一节并写 100 字总结。

## 6. 设计反思题

如果你的 Agent 服务要暴露一个 SDK，借鉴本课写三行设计决定：

- 你的 `prompt()` 返回 receipt 还是结果？为什么？
- 消费者怎么划"这次调用的活动区间"？
- 两个语言的客户端怎么保证不漂移？
