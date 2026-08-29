# L04 练习：源码作业

## 1. 阅读题：四份投影各取什么

填写下表并给出代码依据（`文件:符号`）：模型上下文、UI transcript、token 回放、resume 各自消费日志里的哪些事件？哪些事件对所有投影都不可见（提示：`request/header`、`turn/start` 进不进 `deriveMessages()`）？

## 2. 追踪题：一次压缩的完整旅程

假设 compaction 把事件 10–80 概括成一条摘要。在 `surface.ts` 里追踪：

- replace 计划怎么校验区间两端；
- `sourceEventSeqs` 要满足什么条件（为什么必须完整覆盖 10–80 的每个 surface 节点）；
- 替换落地后 `deriveMessages()` 的缓存发生了什么；
- 日志文件里被写入了哪条（些）新事件、旧事件动没动。

## 3. 阅读题：执法者怎么工作

`packages/core/agent-loop/src/invariant.ts` 除了 messages 逐字节比对还校验了 header 的哪些字段？为什么这个钩子用 prepend（先于其他 listener）挂上？如果它只是个 CI 测试而不是运行时断言，会漏掉哪类漂移？

## 4. 对比题：aborted vs interrupted

在源码里分别找到产生 `turn/end {kind:'aborted'}` 与 `{kind:'interrupted'}` 的代码路径。回答：为什么 loop 永不写 `interrupted`？一个 SDK 消费者看到 `interrupted` 应该推断出进程经历了什么？

## 5. 实验题：亲手制造一次"漂移"

在快照里（可还原）把 `deriveMessages()` 的投影规则改掉一行（例如让 `tool/result` 不进模型视图），跑 `pnpm vitest run packages/core/agent-loop/tests/request-reconstruction.spec.ts`（需 install）。记录哪条 THEOREM 断言变红、错误文本里的关键词。还原。

## 6. 设计反思题

你的 Agent 项目里"模型看到了什么"存在哪？

- 能从存储完整重建昨天某个请求吗？
- 如果明天要加"上下文压缩"，你的历史数据结构允许不改写旧记录地做视图替换吗？
- 用一句话写出你项目的 model-visible means logged 等价物（或承认没有）。
