# L11 毕业练习

## 概念题

1. Definition、Provider、model-facing tool 分别拥有哪类状态？为什么替换 Provider 不应修改 tool schema？
2. 为什么 approval 必须绑定 action、规范化 path 和精确 payload，并且只能使用一次？
3. audit projection、模型历史和 spill canonical value 在 resume 时分别从哪里恢复？

## 必做改造

1. 增加 `git-diff` Evidence Provider。它必须实现现有 Definition，替换 Provider 时不能改 `RepoEvidenceTool`。
2. 为现有 `repo_evidence` record item schema 实现一个无依赖 validator；输入或 Provider 输出不合法时写 audit error 后失败。
3. 把 `AuditLog` 改为 JSONL 文件实现。使用临时目录，模拟写到一半崩溃后 resume；禁止写课程仓库 tracked files。
4. 给 review workflow 加一个失败 child，parent report 必须保留失败终态、error、lineage，不能输出空成功。

## 验收测试

至少提交下面六类检查，并为每条结论写清 evidence boundary：

1. unit：observe-before-modify、空 evidence、越界拒绝、forged/mismatched approval、schema validation；
2. HMR：连续 install/dispose 两次，注册数每次都回到 0；
3. persistence/replay：重启后 projection 和模型历史一致，tampered history 被拒绝；
4. real-composition：用固定上游 checkout 加载你的真实 profile/bundle；
5. keyless snapshot：headless 与 SDK 的核心 durable events 稳定；
6. optional real-API smoke：无 key 显式 skip，有 key 时记录模型、日期、commit、平台和 workspace 外部复读结果。

## 失败注入

1. Provider 返回没有 locator 的 claim；验证 output validator 和 audit 都能捕获。
2. 修改 `normalizePath()`，让 `../` 逃逸；写 property test 生成多层路径并证明 policy fail closed。
3. 删除 `bundle.uninstall()` 的一个 unregister，运行两轮 HMR 检查定位泄漏 owner。
4. 篡改持久化的 model history，但不改 audit event；`resume()` 必须拒绝恢复。

## 设计实验

把内存 Bundle 迁移成固定上游 checkout 中的可安装 profile：画出 package、Cordis plugin、Provider patch、headless entry 和 Python SDK driver 的组装关系；为每一层指定 unit、course-composition、upstream real-composition 或 real-API 证据。没有真实运行的层必须标 `skip`，不能沿用本课模拟器的 `pass`。

## 交付说明

最终报告不要把模拟结论写成生产承诺。分别列出：固定 SHA 上通过的源码/组装证据、keyless deterministic 证据、可选真实 API 证据、指定平台 sandbox 证据，以及尚未覆盖的故障模型。
