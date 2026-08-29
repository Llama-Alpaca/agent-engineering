# Lab 1：第一个插件——亲眼看见一个回合的全部事件

**目标**：把一个你自己写的插件挂进真实 dsh，让它打印出一个完整回合的每一条 durable 事件。做完你会确切知道：插件长什么样、靠什么挂上去、一个回合在事件层面发生了什么。

## 第 1 步：写插件（10 行）

在 checkout 的 `examples/lab-src/hello.ts`（从课程仓 `labs/src/hello.ts` 拷入）：

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lab-hello'

export function apply(ctx: Context): void {
  process.stderr.write('lab-hello: plugin mounted\n')
  ctx.on('session/event', (session, event) => {
    process.stderr.write(`lab-hello: ${event.type}\n`)
  })
  ctx.on('dispose', () => process.stderr.write('lab-hello: plugin disposed\n'))
}
```

这就是一个完整插件的全部：`name` + `apply(ctx)`。没有 SDK、没有脚手架。`session/event` 是广播每条 durable 事件的扩展点；注意监听器签名是 `(session, event)`。

## 第 2 步：挂载（overlay）

同时拷入课程提供的 `scripted-llm.ts`（先当黑盒用，Lab 2 拆开），配 `overlays/lab-1.yml`：

```yaml
- id: agent-default-model
  config:
    provider: lab-scripted
    model: lab-echo-1

- insert:
    - id: lab-scripted-llm
      name: '/path/to/your/deepseek-harness/examples/lab-src/scripted-llm.ts'
    - id: lab-hello
      name: '/path/to/your/deepseek-harness/examples/lab-src/hello.ts'
```

（把路径替换为你的 checkout 绝对路径。）运行前先看一眼树：

```bash
pnpm dsh --profile headless --patch examples/lab-1.yml --dump-config | grep -B2 lab-hello
```

你应该看到（真实输出，路径为作者的 checkout）：

```text
# == /private/tmp/dsh-study/examples/lab/hello.cordis.yml
- id: lab-hello
  name: lab-hello
```

注意那行 `# ==` 注释：dump 给每一行标注**来源层**——你看到的就是你挂载的（深读 02 章）。

## 第 3 步：跑一个回合

```bash
export DSH_HOME=/tmp/dsh-lab-home
pnpm dsh --profile headless --patch examples/lab-1.yml "please greet"
```

stderr 你应该看到（真实输出节选，完整流约 34 行）：

```text
lab-hello: plugin mounted
lab-hello: permission/preset
lab-hello: sandbox/mode
lab-hello: approval/policy
lab-hello: agent/inbox/spliced
lab-hello: turn/start
lab-hello: agent/inbox/spliced
lab-hello: step/start
lab-hello: user/message
lab-hello: user/message
lab-hello: user/message
lab-hello: user/message
lab-hello: session/title
lab-hello: request/header
lab-hello: request/context
lab-hello: session/title-llm-request
lab-hello: assistant/chunk
lab-hello: assistant/chunk
lab-hello: assistant/chunk
lab-hello: assistant/chunk
lab-hello: assistant/chunk
lab-hello: assistant/message
lab-hello: tool/call
lab-hello: tool/result
lab-hello: step/end
lab-hello: step/start
lab-hello: assistant/chunk
...
lab-hello: assistant/message
lab-hello: step/end
lab-hello: turn/end
```

stdout 最后一行：`Lab complete: the scripted model called a real tool and read its result.`

## 刚才发生了什么（对着事件流读）

1. **`turn/start` 在第二次 `agent/inbox/spliced` 之前**——回合先开张、循环才 claim 输入，claim 的 splice 因此落在 turn 内：重启恢复时能区分"跑过的"与"丢弃的"（深读 03 章）。
2. **四条 `user/message`**——你的任务文本只占一条，另外三条是运行时上下文投影（时间、环境提示）。"往 prompt 里塞东西"在上游只有事件这一条合法通道（深读 04/08 章）。
3. **`assistant/chunk` ×5 后一条 `assistant/message`**——chunk 是流式过程，message 是冻结事实；连会话标题（`session/title-llm-request`）也是一次真实的模型请求——标题生成自己就是插件。
4. **`tool/call` 与 `tool/result` 严格配对**——那个 tool call 是 scripted adapter 发出的 bash 调用，**真实**执行了 `echo`（Lab 2 拆开看）。
5. **两个 `step`**——第一步模型要工具、第二步读结果收尾；一个 turn 零或多个 step（深读 03 章的状态机）。

## 第 4 步：拆下来

去掉 `--patch` 再跑一次：你的两行插件消失，事件流里再无 `lab-hello`。挂载与卸载都只是一层 overlay——没有"安装"残留。

## 变体实验（各 5 分钟）

- 监听器里只打印 `tool/*` 事件：`if (!event.type.startsWith('tool/')) return`。
- 故意把 overlay 里的路径写错一位再跑：看错误多么响亮（`failed to import loader entry ... Cannot find package`）——**fail-loud 是设计，不是脾气**。
- 把 `lab-hello` 的 id 改成 `subagent` 再跑：`duplicate loader entry id` ——行 id 是全局命名空间。

## 回答三个问题再走

1. 你的插件靠哪两个导出被识别？它注册的东西在卸载时谁来收尾？
2. `agent/inbox/spliced` 为什么出现两次、分别意味着什么？
3. 为什么插件诊断写 stderr 而不是 stdout？
