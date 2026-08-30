# L00：开箱与源码地图

> 本课问题：这个仓库究竟是什么？一次 `dsh` 启动会加载哪些层？怎样把一个两百多个包的 monorepo 变成"可读的"？

## 为什么第一课读文档：大仓库的"可读性"本身就是设计出来的

常规做法里，一个大 monorepo 的文档是一页 README 加一个随缘更新的 wiki：入口靠 grep 找，"这个东西该在哪改"靠口口相传。它会这样坏掉：

1. **扩展点没有清单**——想加能力的人找不到正确的挂载点，于是去改核心（恰恰破坏了"一切皆插件"）；
2. **文档与代码各自漂移**——架构图说的是三个月前的系统，读者按图索骥撞墙；
3. **人或 agent 无法系统地定位**——每次上手都是一次全仓考古。

dsh 把这三件事都当工程问题解决：`docs/architecture.md` 一页纸讲清架构与「新行为放哪」总表；`module-graph.md`、`config-catalog.md` 由脚本从源码**再生成**（改代码不改文档，任务直接失败）；每个子系统一篇 `docs/subsystems/*.md`。本课先读这些"地图"，因为后续 11 课的每一次深入都会回到它们。

## 先读文档，再读代码

上游自己说得很清楚——`README.md` 第一句定位："an open-source agent harness"，架构是 **"everything is a plugin"**，底座是 Cordis（一篇讲时空可组合性的论文配套实现）。`docs/architecture.md` 是整个仓库最重要的一页，开头两句值得背下来：

> Every part of the product is a plugin, including the model adapter, the tool registry, the session log, and the agent loop itself, so every part is replaceable from configuration.
>
> There is no privileged core to patch: you extend dsh by mounting a plugin beside the others, and registrations are effects that unwind when their plugin unloads.

没有可以 patch 的特权核心；扩展方式是把你的插件挂到别的插件旁边；**注册本身是效应（effect），插件卸载时自动回卷**。这门课后面 11 节都在展开这两句话。

把大仓库变可读的路径（上游已经铺好了）：

| 材料 | 用途 |
|---|---|
| `docs/architecture.md` | 一页纸架构 + 「新行为放哪」总表 |
| `docs/module-graph.md` | 生成式的模块依赖图（由脚本再生成，永不失同步） |
| `docs/capability-seams.md` | 服务/提供者/消费者的能力图谱（L07 主角） |
| `docs/subsystems/*.md` | 每个子系统一篇，约 40 篇 |
| `docs/agent-lifecycle.md` | turn/step 事件时序图（L03/L04 的对照答案） |

## 启动链路：从命令行到插件树

按顺序打开两个文件：

1. **`apps/cli/src/bin.ts`** —— 入口只做一件事：`parseDshArgs` 解析 launcher **自己拥有的** flag（`--profile`、`--patch`、`--dump-config`、`plugin`），第一个不认识的 token 之后全部原样透传给内层 app。设计取舍：launcher 与内层 app 的参数空间严格分离，launcher 永远不知道内层有哪些命令。

2. **`apps/cli/src/profile-boot.ts`** —— `PROFILE_ROOT_CONFIG` 是一段硬编码的**空根配置**，每次启动重写 profile 的 `cordis.yml`（因为 Loader 写回会把组合行烤进文件，下次 boot 就会重复 insert）。注释原文：

   ```ts
   /** The empty root entry list every profile tree patches over. */
   ```

   插件树不是"一份大配置文件"，而是**空树 + 一叠 patch**：`dsh.profile.bundles` 里按序排列的 bundle 层 → profile 自己的 `cordis.patch.yml` → 机器级 patch → `--patch` overlay。每层对行的语义是整行替换。为什么这样设计是 L02 的主题，这里先记住结论：`dsh --dump-config` 打印的任何一行都可以被你自己的 patch 替换，且 dump 与真实 boot 走同一条组合代码——所见即所挂载。

## 上游实验（在你检出的快照里做）

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
git log -1 --format='%H %ci %s'          # 确认在 99f6f02（rc.7，见 upstream.lock.json）
ls packages | wc -l                       # 感受规模
ls packages/core packages/llm             # 找到 core 五件套与 llm
sed -n '1,60p' docs/architecture.md       # 精读开头
grep -n "Where new behavior goes" -A 20 docs/architecture.md   # 出口检查表
```

可选（需要网络）：`npx @deepseek-ai/dsh@0.1.0-rc.6 --help` 观察已发布 CLI 暴露的 profile/patch/dump-config 接口。

## 这样设计买到了什么，付出什么

1. **新人和 agent 都能在一小时内回答"新行为放哪"**——`architecture.md` 的出口表把"想加 X 就挂 Y"列成检查表，本课的毕业检验就是你能用它定位任何一个需求。
2. **文档漂移从道德问题变成工程问题**——生成式文档让"改代码不改文档"直接挂 CI，而不是指望贡献者自觉。
3. **入口诚实**——launcher 只有薄薄一层且只拥有自己的参数；`--dump-config` 与 boot 共用同一条组合代码，打印出来的就是挂载的。

**代价**：文档纪律要求每篇 subsystem 文档随包维护、"新行为放哪"表必须随扩展点演进更新——上游用生成器把这份成本压到最低，但它不会凭空消失。

## 证据边界

- 本课所有引用对锁定 SHA `99f6f02`（rc.7，与 labs 及课程十三共用同一 checkout）负责；上游是 developer preview，README 明说 "THERE WILL BE COMPATIBILITY-BREAKING CHANGES"。
- 读文档与源码证明的是设计意图与结构，不证明上游能安装、构建或跑通真实模型——那需要你在 checkout 里执行 `pnpm install && pnpm run build`（可选实验）。
