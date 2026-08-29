# Lab 2：打开模型的黑盒——写一个 LLM adapter，零 Key 驱动真实循环

**目标**：Lab 1 你把 `scripted-llm.ts` 当黑盒用了。现在拆开它、改它。做完你会确切知道：模型边界（adapter 缝隙）长什么样、chunk 协议怎么组装成消息、以及为什么"剧本模型 + 真实 harness"不是作弊——上游自己的 keyless 测试 lane（`docs/testing.md`）用的就是同一思路。

## 为什么这个设计成立（30 秒）

dsh 对模型 adapter 的全部要求是**一个方法**（`packages/llm/llm/src/index.ts`，`abstract class LlmAdapter`）：

```ts
abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>
```

验证、审批、重试、分层都不归它管（`adapter.ts` 注释自述 "transport-only"）。循环、工具管线、会话日志对"模型是谁"一无所知——所以一个 50 行的剧本 adapter 与一个直连 DeepSeek API 的 adapter，对系统其余部分**完全等价**。这就是缝隙设计（深读 05 章）。

## 第 1 步：读懂这 50 行

`examples/lab-src/scripted-llm.ts` 的核心逻辑只有一次判断：

```ts
const sawToolResult = options.messages.some(
  (message) => message.content.some((block) => block.type === 'tool-result'),
)
if (!sawToolResult) {
  // 第一步：发一个工具调用块
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name: call.name, argumentsDelta: '' }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: call.name, arguments: args } }
  yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 6 } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
} else {
  // 有工具结果了：收尾
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}
```

对照 `packages/llm/llm/src/types.ts` 的 7 种 chunk：`block-start / text-delta / reasoning-delta / tool-call-delta / block-end / usage / finish`，顺序契约一句话——"usage 在 finish 之前，finish 之后什么都没有"。`block-end` 携带**权威完整块**：之后同 index 的迟到 delta 会被唯一组装器（`BlockAssembler`）直接忽略（"ignore stragglers"）。

## 第 2 步：改它（任选两件，改完重跑 Lab 1 的命令）

1. **改工具命令**：把默认 `firstToolCall` 的 `command` 换成 `date`（或 `git log --oneline -1`），description 也改——bash 工具的 schema 要求 description 必填。重跑，看 stdout 之外事件流里的 `tool/result` 是否携带了新输出。
2. **拆成三个 step**：第一步发工具调用；第二步（有 tool-result 时）再发**另一个**工具调用（比如 `args.command: 'uname -s'`）；第三步才收尾。提示：你的判断分支要能区分"没有工具结果 / 一个 / 两个"——`options.messages.filter(...)` 数一数。跑通后事件流里应有**三个 step**、两对 `tool/call`+`tool/result`。
3. **体验错误即事件**：在 adapter 里 `yield { type: 'finish', reason: { kind: 'error', failure: ... } }`（从 `@deepseek-ai/dsh-llm` 构造一个 `LlmFailure`，或直接 throw 一个 Error 看 waterfall 怎么接）——观察循环不崩、错误成为回合的事实。
4. **发一个 reasoning 块再发 text 块**：`reasoning-delta` + `block-end {type:'reasoning'}` 在前、text 在后——这就是 thinking 模型的形状。

## 第 3 步：路由是怎么选到你的 adapter 的

你在 overlay 里做了两件事：插入插件（注册 `lab-scripted` 路由）、把 `agent-default-model` 行**整行替换**为 `provider: lab-scripted`。对照源码：

- 注册：`apply` 里 `ctx.llm.registerAdapter([PROVIDER], adapter)`——与 `llm-deepseek` 注册 `deepseek-official` 完全同构（`packages/llm/llm-deepseek/src/index.ts`）；
- 选择：`packages/bundle/headless/src/index.ts` 读 `ctx.get('agentDefaultModel').currentSelection()`，把 `{provider, model}` 交给 agent 创建——每个请求的 provider 就是查这张路由表。

**真实的坑**（作者亲踩）：若 `$DSH_HOME/settings.yaml` 里存过一次模型选择，**设置面优先于组合面**——你 dump 里明明是 `lab-scripted`，回答的却是真模型。用干净 `DSH_HOME`。

## 你应该看到什么

改完命令重跑（真实输出）：

```text
$ pnpm dsh --profile headless --patch examples/lab-2.yml "please greet"
lab-hello: plugin mounted          # stderr
...（事件流）
Lab complete: the scripted model called a real tool and read its result.
```

stdout 的收尾文本变了（如果你改了 `finalText`），`tool/result` 里携带的是你新命令的真实输出。

## 回答三个问题再走

1. 为什么 adapter 可以只有 `stream()` 一个方法？审批、重试、凭证分别归谁？
2. "usage 在 finish 之前"这条顺序契约如果违反（finish 后再发 usage），会发生什么？（去读 `assembler.ts` 的注释找答案。）
3. 你的 adapter 抛异常与 yield 一个 error finish，对日志配平分别意味着什么？（深读 05 章"错误即事件"。）

## 变体实验

把 `firstToolCall` 配置从 overlay 传进来（yml 的 `config:` 段）——你已经见过 Lab 3 的 overlay 是这么做的：**插件行为由组合层配置**，同一个插件包在不同 overlay 下有不同剧本。这就是"配置即架构"的日常形态。
