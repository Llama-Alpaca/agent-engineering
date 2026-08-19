# DeepSeek Harness 进阶课程设计

## 目标

在课程十二的运行时源码精读之后，补齐 DeepSeek Harness 的协议、SDK、产品表面、Preset、后台任务、Workflow、审批、安全和持续演进能力。课程十三不重复解释 Cordis、Agent Loop 或基础事件溯源，而是研究这些内核如何成为可消费、可测试的产品，并明确指出当前进程内实现与真正跨重启恢复之间的距离。

## 版本与证据

- 上游仓库：`deepseek-ai/deepseek-harness`
- 锁定 SHA：`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- 课程十二基线：`47f943859bef60e4160492346772ded9b24f765a`
- 上游状态：developer preview，不能把 `master` 视为稳定 API
- 离线实验：Node.js type stripping，无网络、无 API Key、无上游依赖安装

## 学习结果

学习者应能：

1. 区分 JSON-RPC 请求、通知、协议错误、诊断输出和 durable event。
2. 解释 SDK 的 durable receipt、notification 和 receipt-to-idle 活动区间，而不把响应误当作整轮结果。
3. 区分 host-computed projection、客户端 higher-seq-wins store 与 conversation window assembler。
4. 解释 preset standing mount、generation 与 transactional `recompose`。
5. 为后台 job 验证 owner fence、first-wins、completion delivery，并把 durable recovery 标成扩展而非现状。
6. 解释 worker-thread workflow 的 child RPC、取消和 materialization 边界。
7. 将审批策略、能力 provider 和原生 sandbox 证据分层验证。
8. 识别上游 unit、coverage gate、real-API E2E、keyless snapshot、Web browser snapshot 五条正式 lane，区分 real-composition 规则与 opt-in perf/stress 诊断，并从 upstream drift report 生成迁移计划。

## 课程结构

| 课次 | 机制 | 失败实验 |
|---|---|---|
| 00 | ACP rich content / JSON-RPC | 非规范 base64、取消后晚入队、stdout 污染 |
| 01 | SDK receipt / notifications | 把 receipt 当最终结果、把无关 idle 错归当前 prompt |
| 02 | Projection / replay | 旧 baseline 覆盖新 frame、窗口前插破坏 identity |
| 03 | Preset / standing mount | 每 session 重挂插件、失败切换丢失旧 generation |
| 04 | Jobs / workflow | kill 提前释放容量、跨 owner 读取、无限 wakeup、自称已持久化 |
| 05 | Approval / sandbox | 审批无成对审计、无 answerer 时 fail-open、策略证据冒充原生隔离 |
| 06 | Test lanes / E2E / performance evidence | 把离线 fixture 冒充上游 E2E、把虚拟 work units 冒充真实性能 |
| 07 | Evolution / capstone | drift 后继续假设旧符号存在 |

## 验收

每课必须包含 README、可运行 `code.ts`、练习和测试。所有确定性测试连续运行两次输出一致；真实上游组合、真实模型、浏览器和原生 sandbox 只以显式 `skip` 或独立环境证据记录，不用离线模型冒充。
