# L08 练习：源码作业

## 1. 验证题：映射表逐行对源码

本课 README 的映射表有 7 行。对每一行在快照里找到对应 `class ... extends Service` 或插件注册的 `文件:行`，抄下注册到哪个 ctx key。任何一行你找不到的，写明你搜了什么、卡在哪。

## 2. 追踪题：一次压缩的竞态防护

`compaction-basic` 里 `replaceGeneration` 出现的位置分别在做什么？构造一个场景：压缩计划生成后、落盘前，tool-result-pruner 先替换了同一段视图——源码里哪行让 compaction 发现代数变化？它接下来做什么？

## 3. 对比题：pruner vs compaction vs spill

三者都可能"减少模型看到的内容"。填表对比：改的是 surface 还是单条结果？需要模型调用吗（model-free 与否）？canonical value 动不动？durable log 动不动？

## 4. 阅读题：runtime context 的完整路径

从"环境发生变化"到"模型在下个请求看到新提示"，追 `runtime-context.ts` 的投影路径。回答：为什么它必须在 `agent/pre-step` 之前的环节入日志？如果它在 buildRequest 时才从内存注入，L04 的哪个断言会红？

## 5. 实验题：给 token-meter 造一次对账

读 `token-meter` 的测试（`packages/llm/token-meter/tests/`），找到"日志重放求 usage"与"usage 缺失时启发式估计"的两个用例并引用断言。回答：如果一个 provider 的 usage chunk 永远缺席，账目的误差边界由什么决定？

## 6. 设计反思题（承接课程十一）

拿出你在课程十一做的收益矩阵（或想象一个）：

- 其中"压缩"一行现在可以标注三个新事实：改写带代数（防竞态）、摘要带 sourceEventSeqs（可追溯）、用户视图不受影响。你的实现有这三条吗？
- 哪一条缺失最可能在生产环境先爆？
