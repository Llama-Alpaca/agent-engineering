# L05：审批、Permission Preset 与沙箱证据

审批不是可转移 token。当前上游的核心契约是一个只读 same-process request：`callId` 指向已经展示的 tool call，`allowed-once` 是唯一授权结果；每次问题和结果必须作为一对 durable audit event 被同一个 open turn 包住。

## 审批状态机

- `ask`：进入 answerer waterfall；无 answerer、answerer 抛错或返回非法值都归一化为 `unavailable`，即 fail closed。
- `never`：在 dispatch 前确定性返回 `rejected`，任何后注册 listener 都不能绕过。
- signal abort：返回 `cancelled`，迟到 answer 被丢弃。
- request 在 idle 时直接抛错且不 append，因为 turn 外单条 audit event 在恢复时是 crash-tail garbage。
- `approval/asked` 与 `approval/decided` 共用 id；invariant companion 同时验证加载历史和新 append。

Permission preset 把 `sandbox/mode` 与 `approval/policy` 两个独立 durable knob 打包。切换先记录 `permission/preset` 用户意图，再只写发生变化的 knob；同一 preset 重选是 no-op。`workspace-write + ask` 与 `danger-full-access + never` 不是一个单维“安全等级”。

## 证据不能混用

| 证据 | 能说明什么 | 不能说明什么 |
|---|---|---|
| Session policy event | 用户选择和恢复后的有效模式 | OS 已真正阻止写入 |
| mock denial | pre-execute 路由与错误映射 | 真实平台 runner 能力 |
| functional native probe | runner 在该环境接受并执行 profile | 所有平台、所有文件系统均同等隔离 |
| Linux/macOS/Windows CI | 对应 runner 的环境证据 | hostile code security sandbox |

`sandbox-local` 在 Linux 依次考虑 bwrap/Landlock，macOS 使用 Seatbelt，Windows 使用 restricted token + ACL；Windows 明确只报告 partial enforcement。没有可用 runner 时必须 fail closed，不能返回原 argv。

## 运行与源码

```bash
node --experimental-strip-types deepseek-harness-advanced-lessons/05_security_approval/code.ts
node --experimental-strip-types deepseek-harness-advanced-lessons/05_security_approval/tests/run.ts
```

阅读 `interaction/user-approval` 的 service/invariant、`interaction/permission-presets`、`sandbox-policy/session-mode.ts`、`sandbox-local` 与 `.github/workflows/sandbox.yml`。课程只模拟决策和证据分类，不执行真实命令，因此不能产出 native sandbox 通过结论。
