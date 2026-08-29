# Labs：在真实 DeepSeek Harness 上动手

六个 lab 全部在**真实上游 checkout**（锁定 `99f6f02` / `dsh@0.1.0-rc.7`）里完成。每个 lab 的命令与"你应该看到"的输出都由课程作者在同一 SHA、Node 25、macOS arm64 上**真实跑通过**——你看到的输出若与之不符，先怀疑自己哪步不一样，再怀疑上游。

## 环境准备（一次性，约 10 分钟）

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
git checkout --detach 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca

node --version    # 需要 ^22.19.0 或 >=24.0.0
corepack enable   # 或：npm exec pnpm@11.7.0 -- 代替下面的 pnpm
pnpm install --frozen-lockfile   # 实测约 46 秒
pnpm run build                   # 构建全部包，实测量级：分钟级

# 课程实验文件就位（本仓 labs/ 的 src 与 overlays 拷进 checkout）
cp -R /path/to/awesome-agent-engineering/deepseek-harness-lessons/labs/src examples/lab-src
cp /path/to/awesome-agent-engineering/deepseek-harness-lessons/labs/overlays/*.yml examples/
# 之后 examples/lab-N.yml 里的 /path/to/your/deepseek-harness 替换为你的 checkout 绝对路径（官方教程同款要求）
sed -i '' 's|/path/to/your/deepseek-harness|'"$PWD"'|g' examples/lab-*.yml
```

**实验隔离**（强烈建议）：不要用你日常的 `~/.dsh`——课程实验可能写设置与会话。用一次性 home：

```bash
export DSH_HOME=/tmp/dsh-lab-home     # 每个 lab 都带着这个变量跑
```

## 课程规矩

1. **零 API Key。** 所有 lab 用你自己的 scripted LLM adapter 驱动真实循环（Lab 2 会解释这为什么不是作弊——上游自己的 keyless 测试 lane 就是这么做的）。
2. **不修改 `packages/` 任何一行。** 你的代码全部是 overlay 挂载的插件——这是这门课要教的扩展方式。
3. **`--dump-config` 是你的眼睛。** 任何"到底挂了什么"的疑问，先 dump 再问人。
4. **stdout 属于产品，stderr 属于你。** 插件诊断一律写 stderr（Lab 1 会看到为什么）。

## Lab 总览（建议顺序）

| # | Lab | 你将亲手做到 | 时间 |
|---|---|---|---|
| 1 | [第一个插件](lab-1-first-plugin.md) | 写观察者插件挂上真实 dsh，亲眼看一个完整回合的全部 durable 事件 | 30 分钟 |
| 2 | [打开模型的黑盒](lab-2-scripted-adapter.md) | 写一个 LLM adapter，零 Key 驱动真实的循环、工具与会话 | 45 分钟 |
| 3 | [自己的工具](lab-3-own-tool.md) | `defineTool` 写真工具，被"模型"调用，走完整条五阶段管线 | 40 分钟 |
| 4 | [读日志](lab-4-read-the-log.md) | 解开持久化会话日志，把事件流对到官方时序图 | 30 分钟 |
| 5 | [策略门](lab-5-policy-gate.md) | 在工具管线上挂拒绝策略，看拒绝如何变成模型可见的事实 | 30 分钟 |
| 6 | [子代理](lab-6-subagent.md) | 委派一个真实子代理，找到它的 durable 子会话 | 30 分钟 |

## 排错清单（全部是真实踩过的坑）

- **插件导入报 `Cannot find package`**：插件的 `name:` 必须是**绝对路径**（"A patch file contributes configuration but does not change the profile directory from which the loader resolves module paths"——官方教程原话）。放 `examples/` 下还能沿 node_modules 解析 `@deepseek-ai/*` 依赖。
- **改了 overlay 里的 `agent-default-model` 却还是真模型在回答**：你的 `$DSH_HOME/settings.yaml` 里可能存过一次模型选择——**设置面优先于组合面**。用干净的 `DSH_HOME` 就不会遇到。
- **`duplicate loader entry id: xxx`**：insert 的行 id 与 base 已有行撞了——给你的行加前缀（base 自带 `subagent`、`llm` 等一大堆 id）。
- **插件里 `ctx.logger` 看不到输出**：headless 组合没有挂 console logger——用 `process.stderr.write`。
- **session/event 监听器签名**：是 `(session, event)` 两个参数，第一个不是事件。
