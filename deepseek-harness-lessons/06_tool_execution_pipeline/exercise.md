# L06 练习：源码作业

## 1. 默写题：五阶段管线

合上材料，默写 createExecution → prepare → dispatch → finalize → finish 每个阶段做什么、谁能改什么。然后对照 `docs/tool-execution-pipeline.md` 的图自检，标出你记错的一个阶段并说明后果。

## 2. 追踪题：wrapper 的三重约束

一个 `tools/execute` 的 around-wrapper 想做三件"坏事"：(a) 换掉 signal 让 caller 无法取消；(b) 返回自己编造的 result；(c) 跳过输出 schema 校验。在 `index.ts` 里分别找到挫败它的代码（提示：`fuseToolSignals`、`normalizeDispatchResult` 的 token 对账、`createSuccessResult` 重验），各引用 `文件:行`。

## 3. 阅读题：排他屏障

`packages/core/agent-loop/tests/tool-calls.spec.ts` 里 "forms a barrier" 用例断言了什么精确顺序？读 `runGroup` 的分组逻辑，回答：为什么排他调用的 barrier 必须覆盖到提交（post-execute 完成）而不仅是执行完成？

## 4. 阅读题：presentations 为什么软验证

找到 presentation 类函数（`presentCall`/`presentResult`）对校验失败的处理方式，对比 `execute` 前的参数硬校验。回答：为什么前者"may run on REPLAY of arbitrary logged args … must never throw"？

## 5. 实验题：亲手加一个 guard

在快照里（可还原）给某个测试写一个最小 guard 插件：拒绝所有名字以 `dangerous_` 开头的调用。跑 `pnpm vitest run packages/core/tools`（需 install）验证你的 guard 生效且**无法被一个后来的 allow listener 翻转**。还原改动。

## 6. 设计反思题

你项目里的工具执行（若有）：

- 模型看到的 schema 和内部执行元数据混在一起吗？
- 并发执行的提交顺序与模型视角的顺序一致吗？
- 取消一个批量调用时，已启动的和未启动的分别怎么收尾？
挑最痛的一条，用本课的对应机制写改法。
