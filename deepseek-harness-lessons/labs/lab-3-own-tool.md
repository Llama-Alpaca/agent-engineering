# Lab 3：自己的工具——`defineTool` 走完整条管线

**目标**：写一个真正面向模型的工具（读 git 状态返回结构化 JSON），让 scripted 模型调用它。做完你会确切知道：工具的输出契约（value/render 分离）、参数 schema 如何自动进入模型可见面、以及你的工具在五阶段管线里被谁检查。

## 第 1 步：对照官方模板写工具

`docs/cookbook/adding-a-tool.md` 给了最小形状；`examples/lab-src/repo-stat.ts`（课程仓 `labs/src/repo-stat.ts`）就是按它写的：

```ts
ctx.tools.register(defineTool({
  name: 'repo_stat',
  description: 'Report the git state of a working directory: current HEAD commit and porcelain status entries.',
  parameters: {
    path: { type: 'string', description: 'Working directory to inspect; defaults to the session workspace.' },
  },
  output: {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  isConcurrencySafe: () => true,
  async execute(args, exec) {
    const cwd = args.path ?? process.cwd()
    const [head, status] = await Promise.all([
      run('git', ['rev-parse', '--short', 'HEAD'], { cwd, signal: exec.signal }),
      run('git', ['status', '--porcelain'], { cwd, signal: exec.signal }),
    ])
    const dirty = status.stdout.split('\n').filter((line) => line.trim().length > 0)
    return { head: head.stdout.trim(), dirtyCount: dirty.length, dirty: dirty.slice(0, 20) }
  },
}))
```

三个必须吃进脑子的契约细节：

1. **value/render 分离**：`execute` 只返回符合 `output.schema` 的 lossless JSON `value`（durable、可替换、可重验）；`render` 是纯函数，把 value 投影成模型可见的内容块。模型、程序、UI 回放各取所需（深读 06 章）。
2. **参数即类型**：`defineTool` 从 `parameters` 推断 `args` 的类型并在执行前**硬校验**——模型给的 JSON 不合形状，根本到不了你的 `execute`。
3. **`isConcurrencySafe: () => true`**：声明这个工具只读、可并发。漏声明会怎样？`isConcurrencySafe` 缺失/抛错/非精确 true 一律按 **exclusive** 处理——fail-closed 分类，排他调用独占成组（这就是你声明它的意义）。

## 第 2 步：让"模型"调用它

`overlays/lab-3.yml` 与 Lab 1 唯一的差别是 scripted adapter 的配置：

```yaml
- id: lab-scripted-llm
  name: '/path/to/your/deepseek-harness/examples/lab-src/scripted-llm.ts'
  config:
    firstToolCall:
      name: repo_stat
      args: {}
    finalText: 'Lab 3 complete: repo_stat reported the git state as canonical JSON.'
```

跑：

```bash
export DSH_HOME=/tmp/dsh-lab-home
pnpm dsh --profile headless --patch examples/lab-3.yml "check the repo"
```

stdout 最后一行（真实输出）：`Lab 3 complete: repo_stat reported the git state as canonical JSON.`

## 第 3 步：看你的工具被谁处理过

打开 Lab 4 的日志（或重跑 Lab 1 的 observer），找到 `tool/result` 事件。你的 `execute` 返回的 value 被冻结成 durable 事实；render 的投影作为模型可见内容。**在到达 execute 之前**，这次调用已经过：参数硬校验 → `tools/pre-execute` waterfall（策略与审批挂这里，Lab 5 亲测）→ 单调 guard；**返回之后**还要 `tools/post-execute`（可替换投影）→ 重新过输出契约 → 冻结。你写的只是中间那段。

一个值得做的对照实验：把 `output.schema` 改成 `{ type: 'string' }` 但 execute 仍返回对象——重跑，看系统如何在契约处响亮拒绝（而不是把畸形值写进日志）。**输出契约不是文档，是闸门。**

## 第 4 步（可选，进真实分发路径）

单文件插件适合实验；真正的第三方插件要打包并走官方安装路径（作者实测全程）：

```bash
# 在 packages/<group>/<name>/ 建标准包（cookbook: adding-a-package），依赖写 peerDependencies
pnpm dsh plugin --profile headless add ../deepseek-harness/packages/lab/lab-hello
# 输出：dsh: warning: lab-hello declares no dsh.bundle — installed as a plain dependency...
```

`dsh plugin` 是 pnpm 转发器：装进 profile、按"是否声明 `dsh.bundle`"自动 reconcile 组合层。装完的插件不用 overlay 也能被解析（`healProfilesModuleFallback` 会把 app 依赖闭包链接进 profile 的 node_modules——深读 02 章的机制在这里兑现）。

## 回答三个问题再走

1. 为什么 `render` 必须是纯函数、且"must never throw"？（提示：它可能在**回放任意历史参数**时运行。）
2. 模型看到的工具 schema 里有哪些字段、绝没有哪些字段？（`packages/core/tools/tests/tools.spec.ts` 里那条 "must never reach the model" 断言测的就是这个。）
3. 你的工具和 bash 工具在管线里走过完全相同的关卡——说出其中三关的名字。
