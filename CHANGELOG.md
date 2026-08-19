# Changelog

本文件从公开发布准备阶段开始记录用户可见变更。格式参考 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)。

## Unreleased

### Added

- 课程十三「DeepSeek Harness 进阶：协议、产品表面与可持续插件工程」（8 课）：锁定上游 commit `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`，覆盖 ACP/JSON-RPC、SDK receipt 活动区间、Host Projection、Preset standing mount、Jobs/Workflow 恢复边界、审批与沙箱证据、E2E/性能和上游迁移；每课提供零 Key 的 TypeScript 实验、练习和测试
- 课程十二「DeepSeek Harness 源码精读与插件工程」（12 课）：锁定上游 commit `47f943859bef60e4160492346772ded9b24f765a`，覆盖 Cordis 生命周期、Profile/Bundle/Patch、Agent Loop、Session 事件溯源、LLM/Tool Runtime、Capability Seam、上下文、Subagent、产品表面与可审计 Bundle；每课提供零 Key 的 TypeScript 实验、练习和测试
- DeepSeek Harness 上游快照准备与漂移检查脚本，以及 Node.js 24 课程 CI（两门课程共 20 套确定性测试）
- 课程十一「Agent 执行骨架与上下文工程 / Harness」（10 课）：上下文账本、压缩纪律、跨会话记忆文件、工具返回值整形、子代理隔离、文件工作区、运行中改道与权限门、渐进披露与收益矩阵评估；research-assistant 升级为长途研究 v5（新增 118 项测试，全仓 592=449+143，分项目实跑与 CI 同口径）
- 课程十「常驻主动式 Agent / Ambient」（10 课）：调度触发、变化检测、增量研究、打扰决策、收件箱、常驻守护、时段预算与收益矩阵评估；research-assistant 升级为常驻主动 v4（新增 112 项测试，全仓 474）
- 中英文 README 首屏、学习路线、作品项目截图与可验证性说明
- 零依赖、零 API Key 的离线 RAG 导览 `quickstart.py`
- 第一课轻量依赖文件 `requirements-quickstart.txt`
- GitHub Actions 测试与覆盖率工作流
- Issue 表单、Pull Request 模板、贡献指南和安全报告流程

### Changed

- 85 节完整目录改为折叠展示，降低 README 首屏信息密度
- 第一课安装命令改为轻量依赖，并修复过期运行路径
- 将环境相关的性能表述改为可验证、可复现的边界说明
