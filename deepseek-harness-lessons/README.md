# DeepSeek Harness 源码精读与插件工程

> 课程十二：从固定源码快照理解 DeepSeek Harness 的插件树、Agent Loop、事件溯源与可替换能力。

本课程不是 DeepSeek 官方文档的翻译，也不是稳定 API 使用手册。它锁定一个可复现的上游源码快照，通过观察、源码导读、最小替换和失败注入，回答一个问题：**一条 Agent 任务怎样穿过插件树、模型流、工具管线和 Session 日志，并在不修改核心 loop 的前提下被扩展。**

## 课程地图

| 课次 | 主题 | 离线产出 |
|---|---|---|
| 00 | 开箱、版本锁定与源码地图 | 快照校验、配置层和事件时间线 |
| 01 | Cordis 插件生命周期 | Service、inject、事件和 disposer 实验 |
| 02 | Profile、Bundle 与 Patch | 配置分层、整项替换和 reload 实验 |
| 03 | Agent Turn / Step Loop | inbox 语义、取消和 balanced trace |
| 04 | Session 事件溯源 | log、surface、replay、resume、fork |
| 05 | LLM 流式 Adapter | chunk、tool call、错误和 retry |
| 06 | Tool Runtime 与安全管线 | schema、policy、并发和取消 |
| 07 | Capability Seam 与沙箱 | Definition / Provider / Consumer 替换 |
| 08 | 上下文、压缩、Skill 与 Spill | 课程十一机制的实现映射和消融 |
| 09 | Subagent、Workflow 与所有权 | spawn/fork、continuation、清理 |
| 10 | 产品表面与验证体系 | headless、SDK、snapshot、real-composition |
| 11 | 毕业项目 | 可审计仓库维护 Agent Bundle |

每课目录都包含 `README.md`、`code.ts`、`exercise.md` 和 `tests/`。`code.ts` 默认是无网络、无 API Key 的确定性实验；需要上游依赖或真实模型的部分会明确标为可选。

## 快速开始

先确认环境：

```bash
node --version                 # ^22.19.0 或 >=24.0.0
corepack pnpm --version        # 课程快照要求 pnpm 11.7.0
```

运行一节离线实验：

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 00
./deepseek-harness-lessons/scripts/run_lesson.sh 06

# 运行 12 节实验和各课 tests/ 下的确定性测试
./deepseek-harness-lessons/scripts/run_tests.sh
```

脚本只使用 Node 的 type-stripping 运行 `.ts`，不需要 API Key，也不安装上游依赖。若要阅读和运行真实上游源码，使用隔离目录：

```bash
./deepseek-harness-lessons/scripts/prepare_upstream.sh
./deepseek-harness-lessons/scripts/check_upstream_drift.sh
```

准备脚本默认把 checkout 放在系统临时目录；它不会修改本仓的 Git 配置、依赖或源文件。上游 `pnpm install` 可能安装 worktree-local hooks 和 native 依赖，只有在你明确要求时才执行。

## 证据边界

- 离线实验证明的是状态机、不变量和设计取舍，不证明真实模型质量。
- 上游源码实验必须记录 commit SHA；不要把 `master` 当前行为当成永久 API。
- 真实 API、原生沙箱和性能结果都带环境、模型、日期和配置，不作为通用生产承诺。
- 工具、文件系统和 SDK 实验只使用临时或可丢弃 workspace。

## 课程顺序

按 L00-L02 基础组装、L03-L07 运行时主干、L08-L10 高级能力与产品入口、L11 毕业项目的顺序学习。12 节离线实验与测试已经完成并接入 CI；真实上游 build 和 real-API smoke 仍是显式可选验证。

## 上游来源

DeepSeek Harness：<https://github.com/deepseek-ai/deepseek-harness>（MIT）。本课程引用的源码快照、commit 和符号清单见 [`upstream.lock.json`](upstream.lock.json) 与 [`source-manifest.json`](source-manifest.json)。
