# 深读指南：做完 lab 之后，带着问题回源码

这份指南是课程的**参考层**：labs 让你把系统跑起来、改起来、拆起来；这里回答"它为什么长这样"。12 篇按同一纪律写：**先摆常规做法、看它在哪里坏掉 → 读 dsh 的机制源码 → 说清买到什么、付出什么代价**——每个论断都钉在真实源码、测试用例名或注释原文上。

用法：不要从头顺读。做完哪个 lab，就读对应章节；每章开头有阅读地图（文件 + 带着什么问题读），结尾有「买到了什么/代价」。

| 做完这个 lab | 读这章 | 回答的问题 |
|---|---|---|
| Lab 1 观察者插件 | [00 地图](deep-reading/00-map.md)、[01 Cordis](deep-reading/01-cordis.md)、[02 组合系统](deep-reading/02-composition.md) | 我的插件是谁挂上去的？为什么卸载会干净？ |
| Lab 2 scripted adapter | [05 LLM 适配](deep-reading/05-llm.md)、[03 输入与循环](deep-reading/03-loop.md) | 我那 50 行 adapter 背后，chunk 协议与循环纪律是怎么设计的？ |
| Lab 3 自定义工具 | [06 工具管线](deep-reading/06-tools.md) | 我的工具从 schema 到 durable result 过了哪五道关？ |
| Lab 4 读日志 | [04 会话日志](deep-reading/04-session.md) | 为什么一份 append-only 日志能喂饱四个消费者？ |
| Lab 5 策略门 | [07 能力缝隙与安全](deep-reading/07-capability.md) | 拒绝为什么不可翻转？隔离强度为什么分层自报？ |
| Lab 6 子代理 | [09 所有权与恢复边界](deep-reading/09-subagent.md) | 子会话为什么 durable、jobs 为什么声明易失？ |
| 全部完成后 | [08 上下文机制](deep-reading/08-context.md)、[10 表面与测试](deep-reading/10-surfaces.md)、[11 毕业扩展](deep-reading/11-capstone.md) | 机制全在扩展点上；表面是薄适配；然后做一次真实扩展 |

## 系统级因果主线

Agent 产品的四根支柱都在以周为单位变化——**模型**（这周直连 DeepSeek、下周换别家 SDK）、**能力**（工具与执行环境从本地到 Landlock/Seatbelt 到 E2B）、**表面**（CLI、Web、ACP、TS/Python SDK）、**策略**（审批、可写根、权限预设，还要热切换）。变化发生在硬编码核心里，每次变化就是一次 fork。dsh 的回答是一个架构判断：**凡是会变的，都是插件**。它立刻带来四个工程问题：

| 领域压力 | 常规做法会怎样坏 | dsh 的回答 | 具体买到什么 | 深读 |
|---|---|---|---|---|
| 能力要可替换，换一次不能漏一次 | 全局回调/单例注册表：卸载残留、HMR 泄漏、事件双处理 | 注册即效应 + Fiber 可逆生命周期 | 装卸 N 次注册数回基线；per-agent 隔离作用域 | 01 |
| 上百插件按什么组合跑 | 大配置 + deep merge：字段来源不可知、回滚≠撤销 | 空根 + patch 层栈，整行替换 | 每个值的来源逐层可解释；dump 与 boot 同一条代码 | 02 |
| 用户、工具、压缩、取消、崩溃并发改写"对话" | 共享 messages 数组：顺序偶然、取消切不干净、崩溃后无法重放 | 唯一入口 inbox + append-only 日志 + 配平纪律 | 取消干净、resume 不丢输入、fork/审计/回放全是日志纯函数 | 03/04 |
| 换执行环境不想改工具代码 | 工具里硬编码 `child_process`：换沙箱 = fork 所有工具 | 三角色 capability seam + 单实现约束 | 换环境 = 一处组合改动；bash 与 fs 圈同一个可写根 | 07 |

## 快照说明（rc.5 → rc.7）

本课程与课程十三统一锁定 `99f6f02`（`dsh@0.1.0-rc.7`）。历史上课程十二曾锁 rc.5（`47f9438`）；两版之间核心六文件（agent.ts、inbox.ts、session、tools、profile、fiber）几乎逐字节未变，本指南全部锚点已对 rc.7 重新核实——唯一漂移是 ACP 的 `settlePrompt` 改名 `settleAfterQuiescence`（[10-表面](deep-reading/10-surfaces.md) 有注记），它正是课程十三毕业课的演进球证。锚点清单见 [anchors.json](anchors.json)，漂移检查见 `scripts/check_upstream_drift.sh`。
