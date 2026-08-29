# L07 练习：源码作业

## 1. 对图题：把 fs 包族标到能力图上

打开 `docs/capability-seams.md`，把 `fs`（Definition）、`fs-local` / `fs-sandbox` / `fs-e2b`（Provider）、`tool-fs` / `fs-observation-policy`（Consumer / 策略）标到对应节点。回答：`fs/write-intent` 事件由谁发、谁消费？observation-policy 为什么是独立插件而不是 fs-sandbox 的一部分？

## 2. 追踪题：换 provider 的完整清单

假设部署要从 `fs-local + bash-local` 切到 `fs-sandbox + bash-sandbox`：

- 在 patch 层面要改哪几行（对照 L02 的整行替换语义）；
- `writableRoots` 怎么保证 bash 与 fs 圈到同一个根（引用代码）；
- tool-fs 里的工具代码需要动几行？

## 3. 阅读题：三种拒绝的语言

`fs-sandbox` 拒绝写越界路径、`sandbox` 后端不可用、approval 无 answerer——三者的错误/结果分别长什么样？为什么进程内围栏"knows exactly what it refused"而 bash 沙箱要从 stderr 方言里推断？

## 4. 阅读题：allowed-once 的生命周期

追踪一次 `ask` → 用户放行 → 执行的完整事件序列（含 durable 审计对）。回答：为什么 grant 只 stamp 到被问的那一次调用，而不是"这个工具以后都放行"？

## 5. 实验题：数一数 ctx.fs 的消费者

在快照里 `grep -rln "inject.*'fs'\|inject.*\"fs\"" packages --include="*.ts" | grep -v tests | head`。挑两个消费者，确认它们都没有 import 任何具体 provider。这印证了哪条设计思想？

## 6. 设计反思题

你的项目里"换一个执行环境"（比如从本地 shell 换到容器）要改几个文件？对照三角色模型：缺的是 Definition、Provider 还是 Consumer 的分离？写一段三行的改造计划。
