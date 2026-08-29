# A05：审批与能力证据——Fail-Closed、成对审计与诚实降级

> 决策案例：一个工具调用需要用户批准，但此刻没有任何 UI 在听（headless 跑批、CI、自动化管道）。放行（别卡住任务）还是拒绝（别做用户没同意的事）？上游的回答干脆得像个公理：没人应答的问题，按拒绝处理。

## 阅读地图

1. `packages/interaction/user-approval/src/index.ts` —— 审批缝隙（本课主菜）
2. `packages/sandbox/sandbox/src/escalation.ts` —— 升级审批
3. `packages/sandbox/sandbox/src/index.ts` —— `ConfinedArgv` 的诚实字段
4. `packages/interaction/permission-presets/src/index.ts` —— UX 层的两个旋钮
5. `packages/fs/fs-sandbox/src/index.ts` —— 对照：进程内围栏的自报

## 案例一：fail-closed 是被归一出来的

`user-approval` 的 `request` 是一个 waterfall，默认终点是 `'unavailable'`。三种"坏情况"全部被折叠到同一个 fail-closed 结果：

```ts
).then(
  // Normalize a rogue (non-vocabulary) answerer return to the fail-closed
  // outcome instead of leaking it into callers' closed-union switches.
  outcome => OUTCOMES.includes(outcome) ? outcome : 'unavailable',
  // A throwing answerer must fail the QUESTION closed, not the caller's
  // tool call open — the seam contains its callbacks.
  () => 'unavailable',
)
```

- 没有 answerer 注册 → `'unavailable'`；
- answerer 抛错 → `'unavailable'`（注释：**问题失败要关着失败，不能把调用者的工具打开**——缝隙要遏制自己的回调）；
- answerer 返回词汇表外的值 → `'unavailable'`（rogue 返回值不得泄漏进调用方的 closed-union switch）。

`'never'` 策略在服务自身的 request 路径决定，早于任何 listener——防止 `prepend: true` 的监听器抢位放宽。

**成对审计**：每次 ask 先 append `approval/asked {id}`，决出后 append `approval/decided {id, outcome}`——"Exactly one per ask"。审计有前置条件 `hasOpenTurn`（turn 之间的裸事件在 reload 时会被当崩溃尾巴丢掉）；任一审计写入失败则整次 request reject——"returning an unlogged decision would violate the pair"。**未落日志的决策不算决策**。

## 案例二：升级审批——只问"变宽"，grant 只 stamp 一次

`escalation.ts` 的 `approveEscalation` 在**任何执行之前**完成：先查 `WIDER_MODES` 严格变宽表——不是变宽的请求根本不问人（不浪费用户注意力）；审批通过后 grant 只 stamp 到被问的那一次调用。`allowed-once` 是唯一授权语义：没有"这个工具以后都放行"。

## 案例三：能力证据的诚实字段

`SandboxProvider.confine` 返回的 `ConfinedArgv` 自带诚实度声明：

- `enforcement: 'full' | 'partial'`——后端自报无法管辖全部承诺的文件效果；"callers requiring an absolute boundary must not treat it as full"；
- `denialSignatures`——**该后端自己的**拒绝方言（bwrap 的 EROFS、Landlock 的 EACCES、Seatbelt 的 EPERM），消费者只匹配自家方言，不匹配跨后端并集（并集会把别家的正常错误误判成沙箱拒绝）；
- 后端不可用 → `SANDBOX_UNAVAILABLE`，"refusing to run the command unconfined"——**没有静默穿透这条路径**。

对照课程十二 L07 的 fs 侧：进程内围栏自我声明 "NOT a kernel boundary"。整条安全叙事的一致性在于：**每一层只声称自己真实拥有的强度**。

## 案例四：permission presets 是 UX，不是新权限模型

`permission-presets`（workspace-write / danger-full-access）只是捆绑开关：一个预设写 `permission/preset` 事件，再写 sandbox-mode 与 approval-policy **两个独立旋钮**的事件；执行、提示、replay 永远读旋钮的 fold，不读预设名。UX 便利不产生第二套真相。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
grep -n "Exactly one per ask" -B2 -A6 packages/interaction/user-approval/src/index.ts
grep -n "WIDER_MODES" packages/sandbox/sandbox/src/escalation.ts | head -3
grep -n "refusing to run the command unconfined" packages/sandbox/sandbox/src/index.ts
grep -n "permission/preset" packages/interaction/permission-presets/src/index.ts | head -3
```

## 设计思想

1. **Fail-closed 靠归一实现**：把"没有应答、应答抛错、应答超纲"三种异构失败折叠成同一个封闭结果——调用方的 closed-union switch 永远不会遇到未知值。
2. **缝隙遏制自己的回调**：审批 UI 的崩溃是审批的问题，不是被审批工具的通行证。
3. **审计与决策原子**：没有成对日志的决策在协议上不存在。
4. **每层只声明真实强度**：partial、方言化拒绝、unavailable——诚实的能力事实让上层能做正确的安全决策。
5. **UX 便利不产生第二套真相**：预设是旋钮组合的快捷方式，执行永远读旋钮。

## 证据边界

- 平台原生隔离（Landlock/Seatbelt/E2B）的实际强度需要各平台实测；本课证明的是证据结构，不是隔离强度。
- 审批 UI 的产品形态（Web 面板、TUI 提示）不在本课范围。
