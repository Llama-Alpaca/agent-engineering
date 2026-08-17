# L07 Capability Seam、Scope 与执行安全

本课把一项能力拆成三个角色：`CapabilityDefinition` 只定义契约，Provider 绑定具体执行世界，Consumer 只面向契约。`createRealm()` 用 profile 值选择 local 或 fake-remote Evidence Provider；同一个 `EvidenceConsumer` 不含 provider 分支。

## 运行

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 07
node --experimental-strip-types deepseek-harness-lessons/07_capability_sandbox/tests/run.ts
```

实验完全在内存中运行，不执行真实 shell。输出显示 Provider 替换、两个 isolated realm、FS/shell 共享 ExecutionWorld、路径越界拒绝、一次性审批重试，以及 scope dispose 后能力整组撤销。

## 关键不变量

- Definition 是稳定契约；Provider 负责 local/remote 实现与所有权；model-facing Consumer 不检测 provider 名称。
- 每个 Agent realm 有独立 scope、workspace、policy 和实例缓存；解析同一 Definition 不会跨 realm 复用 Provider。
- `FILE_SYSTEM` 与 `SHELL` 是同一个 `ExecutionWorld` 的 projection，所以 cwd、文件和 policy 不会分裂成两个世界。
- path 先规范化再检查 workspace 边界；`../secret.txt` fail closed。
- workspace write 默认 `ask`，`approveOnce()` 只放行一次精确 action/target；第二次写入重新要求审批。
- dispose 逆序撤销 provider、清空实例和 workspace；后续 resolve 返回稳定的 `SCOPE_DISPOSED`。
- 已解析的 provider handle 也带 scope 生命周期；scope dispose 后再次调用 remote capability 同样 fail closed。

源码阅读锚点（固定 commit `47f943859bef60e4160492346772ded9b24f765a`）：`docs/capability-seams.md`、`packages/core/scope/`、`packages/fs/`、`packages/shell/`、`packages/subprocess/`、`packages/sandbox/`。

## 平台与证据边界

必修实验只证明 policy、ownership 和 fail-closed 行为，不证明 OS 隔离。这里的 shell 是确定性模拟器；Linux Landlock、Windows ACL、容器或 E2B 必须在支持的平台上单独验证，不能从本实验推导生产安全结论。上游 Definition/Provider API 仍处于 developer preview，具体导入路径以固定 SHA 为准。
