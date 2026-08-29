# L05 练习：源码作业

## 1. 阅读题：chunk 协议契约

读 `types.ts` 的 `StreamChunk` 定义与各 chunk 的 JSDoc。回答：

- `block-end` 为什么携带完整权威块而不只是结束标记？
- `tool-call-delta` 的 `argumentsDelta` 是原始 JSON 字符串片段——为什么不在这里解析？
- 如果一个 adapter 把 `usage` 发在 `finish` 之后，`BlockAssembler` 会怎么处理？

## 2. 追踪题：max-tokens 时发生了什么

从 `assembler.ts` 找到截断时对 tool-call 块的处理。回答：为什么截断的工具调用"不安全、不可执行"？这个决策保护的是 L03/L06 的哪条不变量（提示：每个 `tool/call` 必须有配对 `tool/result`）？

## 3. 阅读题：错误边界

`index.ts` 的流式分发里，`yield` 为什么放在 adapter 拥有的 try 块之外（找到那行注释并引用）？用自己的话说明"adapter 失败→事件、消费者失败→异常"这条边界为什么不能反过来。

## 4. 对比题：两个 adapter，一份协议

对比 `llm-deepseek`（直连 fetch+SSE，错误以 throw 为主）与 `llm-pi-ai`（走 SDK，错误以 in-band 事件为主）：

- 各自怎么把 provider 的错误翻成 `LlmFailure` code？
- pi-ai 的 adapter 为什么显式 `maxRetries: 0`？重试职责在哪一层？
- 两个 adapter 对"上下文超限"的识别最后汇聚到哪个共享函数？

## 5. 实验题：写一个五行的假 adapter

读 `docs/subsystems/llm-streaming.md` 的 adapter 章节（如快照中存在）或直接模仿 `llm-deepseek/src/index.ts` 的注册方式，在纸上（或检出快照的 examples/ 里）写出一个 `echo` provider 的骨架：注册路由、`stream()` 产出两个 text-delta 加一个 finish。不需要跑通——检查三件事：chunk 顺序契约、错误怎么发、配置怎么 thunk 化。

## 6. 设计反思题

你接触过的 LLM 封装层里，错误处理通常长什么样（try/catch 传播？字符串匹配 message？）。对照本课的三条纪律——错误即事件、分类集中、route on code——各写一句你会怎么改。
