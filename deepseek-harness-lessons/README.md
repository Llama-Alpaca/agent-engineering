# DeepSeek Harness 源码精读：架构与设计思想

> 课程十二：读真实源码，学设计决策。锁定上游快照 `47f9438`（`dsh@0.1.0-rc.5` 附近），12 节课沿一条纵向链路把「一切皆插件」的 Agent Harness 读完。

## 这门课是什么（2026-08 重新定义）

本课早期版本把每节课做成"自造模拟器"：课程自己写几百行 TypeScript 复刻上游行为，再测试自己的复刻。实践证明那条路走错了——学习者读完记住的是课程作者的玩具，不是 DeepSeek Harness；模拟器与上游各自漂移，绿测试无法证明任何上游事实。

本课现在的形态是一门**源码导读课**：

1. **材料是上游源码本身。** 每节课回答一个设计问题，给出按顺序打开的真实文件清单（`path` + 读什么、注意什么），摘录带出处的关键源码，分析"问题 → 备选方案 → 为什么这样选 → 付出什么代价"。
2. **作业发生在真实源码里。** 练习是在检出快照中找答案、追链路、跑上游自己的测试、做小改动并验证，而不是运行课程预制的假实现。
3. **课程内容与源码强绑定、可检测漂移。** 每课的 `anchors.json` 登记它引用的每一个路径、符号与源码注释；`code.ts` 是校验器——没有本地 checkout 时校验课程材料自洽（锚点与课程清单一致），有 checkout 时对真实源码逐条复核，上游一变锚点就红。

## 课程地图

| 课次 | 设计问题 | 主要源码 |
|---|---|---|
| 00 | 这个仓库是什么？怎样把它变成可读的 | 根 README、`docs/architecture.md`、CLI 启动链 |
| 01 | 为什么「一切皆插件」不是全局回调集合 | `vendor/cordis/src/*`：Fiber、effect、Service |
| 02 | Web/headless/自定义产品如何从同一套包组装出来 | `app-boot`、`bundle/*/cordis.patch.yml`、`vendor/include` |
| 03 | 一条输入怎样变成模型 step，谁在哪个边界做决定 | `core/agent`、`core/agent-loop` |
| 04 | 为什么对话历史、模型上下文、UI 回放不是同一个数组 | `core/session`：log、surface、deriveMessages |
| 05 | Agent 循环如何做到不依赖某一家模型 SDK | `llm/llm`、`llm-deepseek`：adapter、chunk、组装 |
| 06 | 一个工具从 schema 到 durable result 要过哪些关 | `core/tools`、`agent-loop/tool-calls.ts` |
| 07 | 怎样替换执行环境而不 fork 工具、不改循环 | `core/scope`、`fs/*`、`sandbox/*`、审批 |
| 08 | 课程十一的上下文机制在上游分别挂在哪 | `system-prompt`、`compaction`、`spill`、`skill` |
| 09 | 子任务的新建/fork/后台续跑分别意味着什么 | `subagent/*`、`jobs/*`、`workflow/*` |
| 10 | 同一骨架怎样成为 headless/ACP/SDK/Python 产品 | `bundle/headless`、`acp`、`sdk`、`python/sdk` |
| 11 | 毕业课：把读→改→验证走完整一遍 | cookbook + 一次真实的小插件改动 |

## 怎么学

准备环境（一次性，约几分钟）：

```bash
node --version                 # ^22.19.0 或 >=24.0.0
./deepseek-harness-lessons/scripts/prepare_upstream.sh   # 检出锁定 SHA 到课程缓存目录
```

之后每一课的节奏：

1. `./deepseek-harness-lessons/scripts/run_lesson.sh 03` —— 打印本课问题、阅读地图，并对真实源码校验锚点；
2. 按地图打开源码读，配合每课 `README.md` 的精读与设计决策分析；
3. 做 `exercise.md` 的源码作业（阅读题、追踪题、上游实验题、设计反思题）；
4. 想验证整体没有漂移时，跑 `./deepseek-harness-lessons/scripts/check_upstream_drift.sh`。

不检出上游源码也能运行每课的 `code.ts`（CI 就是这么做的）：它退化为课程材料自洽性校验并输出阅读地图。**但要真正上这门课，请务必检出源码**——本课的功课在源码里，不在本仓里。

## 每课文件约定

| 文件 | 作用 |
|---|---|
| `README.md` | 源码导读正文：问题、阅读地图、源码精读、设计决策、可迁移思想 |
| `anchors.json` | 本课引用的真实路径/符号/注释清单（供校验器与漂移检查使用） |
| `code.ts` | 校验器 + 阅读地图输出（不是模拟实现，不含业务逻辑复刻） |
| `exercise.md` | 源码作业 |
| `tests/` | 对校验逻辑的确定性测试（离线，无网络） |

## 证据边界

- 课程结论只对锁定 SHA `47f943859bef60e4160492346772ded9b24f765a` 负责；上游是 developer preview，`master` 行为随时会变，锚点校验红掉是特性不是故障。
- 离线校验证明"课程引用的锚点存在且一致"，不证明上游能安装、构建或跑通真实模型；那些验证发生在你检出的 checkout 里，按每课 README 的上游实验进行。
- 源码摘录来自 MIT 许可的上游仓库，标注 path + SHA；引用是为教学，本课程与 DeepSeek 官方无关。
- 真实 API、原生沙箱与性能数字都带环境与日期，不作为通用生产承诺。

## 上游来源

DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness>（MIT）。锁定信息见 [`upstream.lock.json`](upstream.lock.json)，各课锚点索引见 [`source-manifest.json`](source-manifest.json) 与每课 `anchors.json`。演进到课程十三（锁定 `99f6f02`）后发生了什么，见 [deepseek-harness-advanced-lessons](../deepseek-harness-advanced-lessons/)。
