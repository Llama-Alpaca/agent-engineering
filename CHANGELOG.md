# Changelog

本文件从公开发布准备阶段开始记录用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)。

## Unreleased

### Added

- 课程十三「DeepSeek Harness 设计决策专题：协议、所有权与演进」（8 课）：锁定上游 commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`，八个设计决策案例（协议边界的诚实设计、receipt 归因、三层投影、组合事务性、所有权围栏、审批与能力证据、五条测试 lane、三快照演进毕业课）；每课提供源码导读 README、锚点清单、校验器、源码作业和确定性测试
- 课程十二「DeepSeek Harness 源码精读：架构与设计思想」（12 课）：锁定上游 commit `47f943859bef60e4160492346772ded9b24f765a`，沿 CLI/Profile → Cordis 插件树 → Agent Loop → LLM/Tool Runtime → Session 日志 → 产品入口的真实源码导读，每课一个设计问题 + 阅读地图 + 决策分析 + 可迁移设计思想；毕业课在真实 checkout 里做一次小插件扩展
- DeepSeek Harness 上游快照准备与漂移检查脚本（含逐课锚点复核），以及 Node.js 24 课程 CI（两门课程共 20 套确定性测试）
- 课程十一「Agent 执行骨架与上下文工程 / Harness」（10 课）：上下文账本、压缩纪律、跨会话记忆文件、工具返回值整形、子代理隔离、文件工作区、运行中改道与权限门、渐进披露与收益矩阵评估；research-assistant 升级为长途研究 v5（新增 118 项测试，全仓 592=449+143，分项目实跑与 CI 同口径）
- 课程十「常驻主动式 Agent / Ambient」（10 课）：调度触发、变化检测、增量研究、打扰决策、收件箱、常驻守护、时段预算与收益矩阵评估；research-assistant 升级为常驻主动 v4（新增 112 项测试，全仓 474）
- 中英文 README 首屏、学习路线、作品项目截图与可验证性说明
- 零依赖、零 API Key 的离线 RAG 导览 `quickstart.py`
- 第一课轻量依赖文件 `requirements-quickstart.txt`
- GitHub Actions 测试与覆盖率工作流
- Issue 表单、Pull Request 模板、贡献指南和安全报告流程

### Changed

- **两门 DeepSeek Harness 课程验收修复**（2026-08-30，独立验收发现的问题逐项修复，全部修复经复跑验证）：
  - 修复 A07 毕业课指向已删除的第二版文件布局（`10_surfaces_testing/code.ts`、`{lesson}_*/code.ts`）——drift 审计改用现有课程级 `scripts/check_anchors.ts`，命令全部重新实测（rc.5 树上 1/82 锚点断裂 `settleAfterQuiescence`、rc.7 与 master `b150a551` 全绿；44 锚点在 master 全部存活）
  - 纠正 A07 一处未核实的演进声称：workflows 实为 rc.5/rc.7 均 15 个 → master 18 个，新增 `ci-master`/`release-publish`/`release-vendor-publish` 发布管道（非平台 lane，平台 lane 在 rc.5 已齐备）；补记 `b150a551` 完整 SHA
  - 修复 L00 残留 rc.5 锁定 SHA（"确认在 47f9438"两处 → `99f6f02`）；课程十三交叉引用统一为 A0x 编号（L02/L05/L09/L10 四处原混用 L0x）；L05 演进注脚改写为 rc.5→rc.7 口吻并在正文补 `assembled()`（rc.7 已引入，原注脚仍自述"本快照 rc.5"）；deep-reading.md "唯一漂移"措辞区分为锚点断裂与语义演进；L08 补课程十一（`harness-lessons/`）前置说明；英文根 README 课程汇总行同步为 6 lab + 12 章
  - A00/A03 的破坏实验升级为作者实测并写进正文（A00：82 绿 → 取消围栏内插 await → `honors cancellation in the admission-to-followup handoff gap` 红 `expected [ { provider: 'mock', … } ] to deeply equal []`；A03：38 绿 → 短路 apiproxy 的 `sessionBlank` 守卫 → `refuses once the conversation has started` 红——并修正原文指错的守卫位置：守卫在调用方 apiproxy，不在 `recompose`）
  - 维护设施修复：两门课 `check_anchors.ts` 删除 `.dsh-source-present` 死代码、修复 `BROKEN ANCHOR` 输出丢失路径的 bug；课程十三 `anchors.json` 44 条锚点补 `doc` 字段映射到对应案例；lab-2/lab-4 overlay 注释修正
- **两门 DeepSeek Harness 课程第三次重定义：从「导读课」改为「动手课」**（2026-08-29，用户评审结论：纯导读相对官方文档价值增量不足，学习者全程在"读"从没在"做"）：
  - 课程十二重构为「实战通读」——`labs/` 六个实验（观察者插件、scripted LLM adapter 零 Key 驱动真实循环、defineTool 真工具、读 append-only 会话日志、策略门拒绝、委派子代理并找到 durable 子会话），全部命令与输出由课程作者在锁定 SHA 真机执行验证；旧 12 个"每课五件套"目录删除，课文精华迁移为 `deep-reading/` 12 章参考层；锚点从每课收敛为课程级 `anchors.json` + `scripts/check_anchors.ts`
  - 课程十三重构为「设计决策案例研习」——`cases/` 八个案例统一工序（困境 → 选项 → 证据 → 动手验证 → 代价 → 迁移）；新增 break-it 实验法并由作者实测（A05：基线 38 绿 → 删除 fail-closed 归一化一行 → `normalizes a rogue non-vocabulary answer to unavailable` 变红 `expected 'yolo' to be 'unavailable'` → 还原全绿；jobs+preset 基线 194 绿实测）
  - 两课统一锁定 `99f6f02`（rc.7，一个 checkout 服务两门课；课程十二自 rc.5 迁移，82 锚点对 rc.7 复核仅 1 处符号改名）；CI 脚本入口不变
- **两门 DeepSeek Harness 课程升级为「why 优先」写法**（2026-08-29）：课程十二每课新增「常规做法会怎么坏」核心段——先摆业界直觉做法、走 2–3 个具体失败场景（每个都能指到上游为它写的测试/invariant/注释），再进入源码精读；课末格言式「设计思想」改为「这样设计买到了什么，付出什么代价」。两门课 README 各新增一条系统级设计主线（课程十二：领域压力 → dsh 的回答 → 具体买到什么；课程十三：八个决策背后的共同边界压力与「哪种坏可逆」方法论），课程十三每课补齐「代价」块。中英文根 README 课程引言同步改写
- **两门 DeepSeek Harness 课程重新定义**（2026-08-29，见 `docs/superpowers/specs/2026-08-29-deepseek-harness-course-redefinition.md`）：从「自造模拟器实验课」改为「读真实源码、学设计决策」。删除每课 300–870 行的课程自建模拟实现，代之以锚点机制——每课 `anchors.json` 登记引用的真实路径/符号/注释，`code.ts` 变为校验器（无 checkout 时校验课程材料自洽，有 checkout 时对真实源码逐条复核），`exercise.md` 改为在真实源码里完成的作业；上游漂移会响亮失败而非静默过期。两门课 20 节正文全部重写，中英文 README 同步更新
- 85 节完整目录改为折叠展示，降低 README 首屏信息密度
- 第一课安装命令改为轻量依赖，并修复过期运行路径
- 将环境相关的性能表述改为可验证、可复现的边界说明
