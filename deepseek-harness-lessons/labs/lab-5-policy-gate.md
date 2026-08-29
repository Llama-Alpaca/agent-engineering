# Lab 5：策略门——在工具管线上挂拒绝，看它变成模型可见的事实

**目标**：用官方 permission-gate 模式（`docs/cookbook/extension-cookbook.md`）在真实管线中间挂一个策略：拒绝所有 bash 调用。做完你会确切知道：策略挂哪、拒绝长什么样、以及为什么"拒绝"被设计成不可翻转。

## 第 1 步：写策略门（15 行）

`examples/lab-src/deny-bash.ts`（课程仓 `labs/src/deny-bash.ts`）：

```ts
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'

export const name = 'lab-deny-bash'

export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec: ToolExecution, next): Promise<PreToolDecision> => {
    if (exec.name === 'bash') {
      return { kind: 'deny', reason: 'Lab 5: bash is denied by the policy gate plugin.' }
    }
    return next()
  })
}
```

两个要点：`tools/pre-execute` 是 **waterfall**——不调 `next()` 就是否决；返回的是类型化决策（`allow/deny/ask`），不是布尔。

## 第 2 步：让 scripted 模型去撞门

`overlays/lab-5.yml`：scripted adapter 保持默认剧本（第一步调 bash）+ 挂上门。跑：

```bash
export DSH_HOME=/tmp/dsh-lab-home
pnpm dsh --profile headless --patch examples/lab-5.yml "run ls"
```

stdout 最后一行（真实输出）：`Lab 5 complete: the bash call was denied by policy and the model saw the reason.`

**关键**：回合没有崩、没有挂起。去日志里看那条 `tool/result`（真实输出，节选）：

```json
{"type":"tool/result","seq":22,...,
 "data":{...,"content":[{"type":"tool-result","toolCallId":"lab-call-1",
   "content":[{"type":"text","text":"Error: Lab 5: bash is denied by the policy gate plugin."}],
   "isError":true}],...}}
```

拒绝被**折叠成一个 isError 的工具结果**：模型在下一个请求里看到它、可以改道（我们的剧本直接收尾）。日志配平不破——`tool/call` 依然有配对的 `tool/result`。

## 第 3 步：把三个设计决策变成体感

1. **策略是可组合的层，不是工具里的 if。** 你没有改 bash 工具一行、也没有改循环一行。审批（`user-approval`）、沙箱策略、你的门——全挂在同一条 waterfall 上按序运行。
2. **"ask" 是三态之一，且 fail-closed。** 把你的 deny 改成 `{ kind: 'ask', ... }` 再跑（headless 没有人应答审批）：结果归一为 `unavailable`——**没人应答的问题按拒绝处理**（`user-approval/src/index.ts` 的归一化注释："A throwing answerer must fail the QUESTION closed, not the caller's tool call open"）。课程十三 A05 会用 break-it 实验证明这条归一化有测试执法。
3. **最终拒绝另有专门机制。** waterfall 里的 deny 理论上可能被顺序靠前的 listener 放行再翻转吗？——对"策略"可以争，对"不变量"不行：`ctx.tools.guard()` 返回 `string | undefined`，**没有 allow 返回值**（类型注释："Because guards have no allow result, listener ordering cannot turn a denial back into permission"）。把你的门从 `ctx.on('tools/pre-execute', ...)` 改成 `ctx.tools.guard(...)`（返回拒绝理由字符串或 undefined），再写第二个"放行"的 pre-execute listener——验证无论顺序，拒绝都翻不掉。

## 回答三个问题再走

1. 拒绝为什么会出现在 `tool/result` 而不是让回合失败？（对照深读 03 章"配平纪律"：每个 `tool/call` 必须有配对结果，replay 才合法。）
2. waterfall 策略与单调 guard 各自适合什么？各举一个例子。
3. 想给"只拒绝写操作、放行读操作"的细粒度策略——挂哪个扩展点最合适？

## 变体实验

把拒绝理由换成给模型的**指导性反馈**（"bash is denied; use repo_stat instead"），并让 scripted adapter 第二步调 `repo_stat`——你就用策略把模型"改道"了。这正是沙箱拒绝信号（`denialSignatures`）设计的用意：拒绝要能指导下一步，而不是只制造失败。
