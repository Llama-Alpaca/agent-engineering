# L09 练习：源码作业

## 1. 追踪题：fork 的家谱

从 `subagent-fork-in-process` 找到子会话 header 写入的字段清单（parentSession、seedLength、delegationDepth……）。回答：delegationDepth 为什么必须是 durable 的？一个 continuable 子代理冷恢复后，哪部分状态来自日志、哪部分来自 descriptor？

## 2. 阅读题：owner fence 的三重校验

在 `jobs-local/src/index.ts` 里找到 (a) owner id 校验、(b) owner 必须是当前注册实例的校验、(c) 准入时的能力检查（servesOwner）。对每一处引用代码并回答：绕过任意一重分别能造成什么？

## 3. 阅读题：first-wins 与宣布顺序

`jobs-local` 的结算函数为什么 (a) 已终态直接 return、(b) 先落账再释放 waiter、(c) completion 最后宣布？把 (c) 的注释理由（reporter 可能同步开模型 turn）翻译成你自己的话。

## 4. 对比题：三个重启场景

分别描述：(a) 父 agent 崩溃时正在跑的 continuable 子代理、(b) 一个运行中的 job、(c) 一个 workflow run——重启后各自还剩什么？哪些能恢复、依据哪个声明或机制？

## 5. 实验题：给三个需求选机制

- 需求 A：让一个"审查员"用与主对话完全无关的视角通读代码并交报告；
- 需求 B：跑一个 40 分钟的构建，期间主对话继续干活，之后取结果；
- 需求 C：并发跑 8 个 agent 做网格搜索，任一失败不拖垮其他。
各选一种机制并说明为什么另外两种不合适（用本课对比表的维度）。

## 6. 设计反思题

你的项目里"后台工作"的状态放在哪（内存 dict？数据库？）？对照 jobs 的三纪律（owner fence、first-wins、易失性声明）：你违反过哪条、后果是什么？
