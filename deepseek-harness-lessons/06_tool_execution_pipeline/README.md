# L06 Tool Runtime：Schema、安全流水线与并发调度

本课把一次 model tool call 展开成可审计流水线：schema 解析 -> policy（allow/ask/deny）-> pre-execute -> monotonic guard -> around wrapper -> execute -> post-execute -> definition finalizer -> canonical、冻结的 result。`runBatched()` 再把安全并发和 exclusive barrier 与 model-order commit 分开。

## 运行

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 06
node --experimental-strip-types deepseek-harness-lessons/06_tool_execution_pipeline/tests/run.ts
```

实验只使用内存 workspace。正常路径并发读取两个文件、串行写入一个文件；负例覆盖 deny、ask 拒绝、schema 错误、timeout，以及滚动并发池取消时的 synthetic result。

## 关键不变量

- `defineTool()` 同时声明输入 schema、模型渲染、并发类别和执行函数；schema 错误在副作用前失败。
- policy 的 `deny` 和未通过的 `ask` 都产生明确的 `tool/result`，不会调用 execute。
- post hook 可把内部结果转为 canonical JSON；最终 result 深冻结，避免后续 middleware 改写审计事实。
- 非法 timeout 在 dispatch 前拒绝；post-execute 中到达的 abort 也必须先于 finalizer 和最终 `tool/result` 生效。
- safe calls 可以同时 dispatch（trace 中 `maxActive >= 2`），exclusive call 形成 barrier；最终提交按 `order`，不按完成先后。
- timeout 会等待已启动操作 drain 后再写结果；abort 时已启动调用得到 `started: true` 的 cancelled，尚未 dispatch 的调用得到唯一 synthetic error。
- `runCodeModeSubcalls()` 只增加 `tool/code-dispatch` 审计；嵌套调用仍走同一 schema、policy、guard、执行和 finalizer 管线。

源码阅读锚点（固定 commit `47f943859bef60e4160492346772ded9b24f765a`）：`packages/core/tools/src/index.ts`、`packages/core/tools/src/schema.ts`、`packages/core/agent-loop/src/tool-calls.ts`、`docs/tool-execution-pipeline.md`。

## 证据边界

这里的 policy、workspace 和调度器是 keyless 教学模型，不等同于原生 sandbox 或真实命令执行的安全证明。上游工具事件和 hook 名称可能随 developer-preview 版本变化；阅读源码时以固定 SHA 为准。
