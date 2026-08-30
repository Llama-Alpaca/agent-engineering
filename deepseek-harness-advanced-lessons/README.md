# 课程十三：DeepSeek Harness 设计决策案例研习

> 八个决策案例，锁定上游 `99f6f02`（rc.7，与课程十二共用 checkout）。前置：完成课程十二的 labs。

## 这门课是什么（2026-08 第三次重定义）

与课程十二一起改过两次方向：模拟器版错了（学的不是上游）；纯导读版也不够（读源码知道"是什么"，论证不出"为什么非这样不可"）。本版把每个决策做成**案例研习**，用一套固定工序把"为什么"变成可以亲手验证的事：

1. **困境**——一个无法消除的坏情况（取消竞态、进程死亡、无人应答、跨端并发……）；
2. **选项**——几个都带伤的做法，坏处各是什么；
3. **上游的选择与证据**——源码注释、测试用例名、README 的 Known Limitations（上游把 why 留在了这些地方，我们只是带你找到它们）；
4. **动手验证**——跑上游自己的执法测试（绿是基线）；**break-it**：临时删掉那个决策，看哪个测试变红，还原（A00/A03/A05 有作者逐条实测的完整流程：如 A05 的 38 绿 → 删一行 → `normalizes a rogue non-vocabulary answer to unavailable` 红，失败信息 `expected 'yolo' to be 'unavailable'` → 还原 → 38 绿；A03 的 38 绿 → 短路 apiproxy 的 `sessionBlank` 守卫 → `refuses once the conversation has started` 红）；
5. **代价**——每个决策诚实地计账；
6. **迁移**——这套判断在你自己的系统里什么时候适用。

八课共享一个方法论：**在都带伤的选项里，选"哪种坏是可逆的"**——孤儿附件是可回收垃圾、晚入队的消息是永久的协议语义错误，所以选前者。

## 案例地图

| # | 案例 | 困境 | 亲手验证 |
|---|---|---|---|
| 00 | [协议边界的诚实设计](cases/00-protocol-boundary.md) | 取消赢得 admission：孤儿附件还是晚入队消息？ | 取消竞态用例 + break-it 实测 |
| 01 | [归因：Receipt 而非结果](cases/01-receipt-not-result.md) | 服务器为什么拒绝回答"这次调用发生了什么"？ | TS/Python 双实现十字检查 |
| 02 | [投影的分层](cases/02-layered-projections.md) | 同一份会话真相三层各算一遍：浪费还是分工？ | higher-seq-wins 用例 |
| 03 | [组合的事务性](cases/03-transactional-composition.md) | 已在产出的会话为什么不许换工具组合？ | 实测 194 绿基线 + break-it 实测 |
| 04 | [所有权围栏](cases/04-ownership-fences.md) | 边界靠保密还是授权？重启丢什么要不要写进文档？ | 实测基线 + owner fence 破坏 |
| 05 | [审批与能力证据](cases/05-fail-closed-approval.md) | 没人应答：放行还是拒绝？ | **break-it 全流程实测** |
| 06 | [证据分层](cases/06-evidence-layers.md) | 五条测试 lane 各证明什么、绝不证明什么？ | replay 只读纪律的 CI 证据 |
| 07 | [毕业：真实演进](cases/07-evolution-capstone.md) | 上游在跑，课程锁快照——演进怎么当教材？ | 三快照 drift 审计 |

## 怎么学

与课程十二同一个 checkout（`99f6f02`，见其 [labs/README](../deepseek-harness-lessons/labs/README.md) 的环境准备）。每读完一个案例，**必须做它的动手验证**——"跑一遍执法测试、删一行看它变红"给你的说服力，十遍精读也替代不了。

维护设施与课程十二同构：[anchors.json](anchors.json)（44 个源码锚点）、`scripts/check_upstream_drift.sh`（对锁定 SHA 逐条复核）、`scripts/run_tests.sh`（CI 的 keyless 校验）。

## 诚实边界

- 案例正文与锚点对 `99f6f02` 负责；对 rc.5 的对比引用对 `47f9438` 负责；对 master 的观察带观察日期（2026-08-27，`b150a551`）。
- 标注"建议破坏实验"的步骤未由作者逐条执行（标注"实测"的都执行过）；破坏实验一律在可丢弃 checkout 进行，做完必须 `git checkout --` 还原。
- 课程与 DeepSeek 官方无关；引用遵循 MIT，标注 path + SHA。
