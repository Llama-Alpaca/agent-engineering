# L00 练习：源码作业

以下作业都在检出的上游快照（`scripts/prepare_upstream.sh` 的输出目录）里完成。引用答案一律给出 `文件路径 + 符号/行内片段`。

## 1. 阅读题：三类事件域

`docs/architecture.md` 的 Events 一节把事件分成 Session events、Agent events、Capability events 三个域。回答：

- 哪个域的事实必须能活过 reload？对应哪种存储？
- 想观察"正在飞行中的工作"应该挂哪个域？
- 想给 `fs/*` 附加策略而不导入 agent loop，用哪个域？

## 2. 阅读题：Launcher 的边界

在 `apps/cli/src/bin.ts` 与它调用的参数解析代码里找到"第一个不认识的 token 之后全部透传"的实现。引用代码位置，并回答：为什么 launcher 不试图理解内层 app 的命令？

## 3. 追踪题：空根的去向

从 `PROFILE_ROOT_CONFIG` 出发，找到它被写入哪个文件、为什么每次启动都要重写（注释里给了理由——引用它）。再找出 `allPatches` 一类函数里 patch 层的叠加顺序。

## 4. 实验题：给仓库画一张自己的地图

在快照根目录执行：

```bash
ls packages/core packages/llm packages/bundle
cat packages/bundle/base/package.json | grep -A3 '"dsh"'
```

回答：`dsh.profile` 与 `dsh.bundle` 字段分别声明了什么？`dsh-base`、`dsh-web-app`、`dsh-headless` 三个包各自的角色是什么？

## 5. 设计反思题

`docs/architecture.md` 的 "Where new behavior goes" 表列出了十几种扩展机制，没有一行是"修改核心代码"。对照你自己的项目：挑三个你最近加的功能，它们各自落在哪一行？如果有落不进的，缺的是哪种机制？

## 6. 可选实验（需要网络）

`npx @deepseek-ai/dsh@0.1.0-rc.6 --help` 与 `--dump-config`（若可用）。对照 `bin.ts` 读取的 flag 清单，确认发布版与源码快照的 launcher 接口一致。
