# DeepSeek Harness 进阶：协议、产品表面与可持续插件工程

> 课程十三：在课程十二的运行时骨架之上，继续研究 DeepSeek Harness 如何被协议、SDK、Web/TUI、Preset、后台任务和测试系统消费，并把源码事实、课程模型与工程扩展严格分开。

本课程锁定上游 `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`（`dsh@0.1.0-rc.7` 附近的 `master` 快照）。课程十二使用的 `47f9438` 已经不是当前上游，因此每节课都把“快照事实”“可迁移原则”和“课程离线模型”分开记录。

## 课程地图

| 课次 | 主题 | 离线产出 |
|---|---|---|
| 00 | ACP rich content / JSON-RPC 边界 | 图像 admission、取消竞态、NDJSON framing 与 stdout 纯度 |
| 01 | SDK receipt 与活动区间 | `messageId` receipt、notification、receipt -> idle 归因与进程回收 |
| 02 | Host Projection、Replay 与长列表 | higher-seq-wins、窗口替换/前插、lineage 与递归工具树 |
| 03 | Preset、Standing Mount 与切换事务 | 单 preset 单挂载、scope join、generation、失败 recompose 回滚 |
| 04 | Jobs、Workflow 与恢复边界 | owner fence、first-wins、bounded wakeup、worker 取消与持久化缺口 |
| 05 | 审批、权限与沙箱证据 | ask/never、成对审计、permission preset 与原生隔离证据 |
| 06 | E2E、Snapshot 与性能证据 | 五条正式测试 lane、real entry、replay 与 opt-in browser 诊断 |
| 07 | 上游演进与毕业项目 | `rc.5 -> rc.7` 真实 blob drift、迁移门与消费者兼容矩阵 |

## 快速开始

环境要求与课程十二相同：Node.js `^22.19.0` 或 `>=24.0.0`。离线实验不安装上游依赖、不需要 API Key，也不访问网络。

```bash
./deepseek-harness-advanced-lessons/scripts/run_lesson.sh 00
./deepseek-harness-advanced-lessons/scripts/run_tests.sh

# 可选：准备真实上游快照并校验源码锚点
./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh
./deepseek-harness-advanced-lessons/scripts/check_upstream_drift.sh
```

每节课包含 `README.md`、`code.ts`、`exercise.md` 和 `tests/`。脚本使用 Node 的 type stripping 直接运行 TypeScript；输出是确定性的，适合重复运行和 CI。

## 三层事实

| 层级 | 本课程如何处理 |
|---|---|
| 上游已有 | 用锁定 SHA 下的路径、符号和测试锚点说明，不从课程模拟器反推 |
| 课程模型 | 用零 Key、确定性 TypeScript 复现状态机和竞态，不冒充上游包 |
| 工程扩展 | checkpoint、跨进程恢复、签名批准等当前上游未提供的能力，明确标作下一步设计 |

## 证据边界

- 离线模型证明协议不变量、状态机、幂等性和测试设计，不证明真实上游 UI、模型质量或平台沙箱隔离。
- 上游源码证据必须带 commit SHA；`master` 的后续提交可能改变路径、事件名和 CLI 参数。
- `real-composition`、真实 API、浏览器 E2E、原生 sandbox 和性能数字都属于环境相关证据，课程只提供显式的 `skip` 或可替换 fixture。
- 协议 stdout、durable event log 和诊断日志是三条不同边界；练习要求不能用日志污染协议输出来“伪造通过”。
- 当前 `jobs-local` 把记录保存在进程内，重启不会恢复任务；worker thread / VM 提供可终止的执行边界，不是 hostile-code security sandbox。

## 上游索引

本课程关注的上游路径和符号见 [`upstream.lock.json`](upstream.lock.json) 与 [`source-manifest.json`](source-manifest.json)。锁定快照来自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
