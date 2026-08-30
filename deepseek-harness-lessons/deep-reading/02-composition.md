# L02：Profile、Bundle 与 Patch——配置即架构

> 本课问题：Web、headless 和自定义部署如何从同一套 package 组装出来？为什么 patch 是整行替换而不是 deep merge？

L01 说了"一切皆插件"，但插件从哪来、以什么组合跑起来？答案不在代码里，在**组合系统**里：一个运行中的 dsh = 一棵由配置组装出的插件树。

## 常规做法会怎么坏：大配置 + deep merge 的三种病

多数系统的常规做法是"一份大配置文件 + 各层 deep merge"（基础层给默认值，用户层覆盖个别字段）。它坏起来的方式很典型：

1. **字段来源不可知。** 上游升级把某行加了一个新字段，用户 patch 只覆盖了半个字段——merge 出一个谁都没写过、只在用户机器上出现的组合。排查时没人能回答"这个值到底来自哪一层"。
2. **回滚不等于撤销。** deep merge 之后，删掉用户 patch 不一定回到上游原状（merge 过程可能已经把展开值烤进缓存）——"撤销"失去定义。
3. **工具与真实各说各话。** dump/inspect 命令往往自己再实现一遍 merge 逻辑，输出和真正 boot 的组合悄悄不同——你看到的不就是你挂载的。

dsh 的回答在第 2、3 种病上是**结构性**的：整行替换（没有 merge，来源只有"至多一个 bundle 层 + 用户层"）、`structuredClone` 输入（patch 永远不能把值烤进缓存）、dump 与 boot 走**同一次** `applyEntryPatches` 调用。第一种病则被公开声明的取舍消化：整行替换要求 patch 重述全部字段，啰嗦换来可解释——上游把这个取舍直接写进 Known Limitations 而不是用 merge 魔法掩盖。

## 阅读地图

1. `apps/cli/src/profile-boot.ts` —— 层从哪来、顺序是什么
2. `packages/boot/app-boot/src/profile.ts` —— profile/bundle 的解析与校验
3. `packages/bundle/base/cordis.patch.yml`、`web-app`、`headless` 的 patch —— 三个真实产品的组装清单
4. `vendor/include/src/index.ts` —— patch 应用算法（本课核心）
5. `packages/bundle/base/README.md` —— 上游自己写的取舍说明
6. `packages/boot/app-boot/src/index.ts` —— boot、fail-loud 与 dump

## 精读一：树 = 空根 + patch 层栈

回忆 L00 的 `PROFILE_ROOT_CONFIG`：根是空的 entry list。真正的树由 `allPatches`（`profile-boot.ts`）按固定顺序叠出来：

```text
dsh.profile.bundles 里按声明顺序的每个 bundle 的 patch
→ profile 自己的 cordis.patch.yml
→ $DSH_HOME 的机器级 cordis.patch.yml
→ 命令行 --patch overlays（argv 顺序）
→ telemetry 开关 patch
```

三个角色分工清晰：**bundle 是插件的发布单位**（一个包 + 一份 `cordis.patch.yml`，在 `package.json` 的 `dsh.bundle` 字段声明）；**profile 是组合单位**（`dsh.profile.bundles` 列出要叠哪些 bundle，`web`/`headless` 只是模板）；**patch 是唯一的修改方式**。

## 精读二：整行替换，没有 deep merge

打开 `vendor/include/src/index.ts` 的 `applyEntryPatches`，patch 命中一个已有 id 后做的事是：

```ts
for (const [key, value] of Object.entries(overrides)) {
  if (key === 'id') continue
  target[key] = value
}
```

`config` 键被**直接赋值覆盖**——这就是"不做 deep merge"的全部实现。上游没有掩饰这个取舍，`packages/bundle/base/README.md` 的 Known Limitations 第一条原文："A patch replaces whole row configs — profile overrides must restate every field a row keeps; **there is no deep-merge layer**."

**为什么？** 读 `base/cordis.patch.yml` 开头的注释："Row order carries no load semantics (activation is service-availability driven)"——行的**顺序不参与加载语义**，激活由服务可用性驱动（L01 的 inject/epoch）。每个 bundle 的 patch 里还有成对的平台门控行（`disabled: !!js process.platform === 'win32'` 与反转表达式），保证每个 host 恰好激活一个 shell 栈。把这些放在一起看，设计意图是：**任何一行的最终值都只能来自"至多一个 bundle 层 + 用户层"，因而是可解释、可回滚、可标注来源的**。deep merge 会制造"某个字段到底来自哪层"的不可知状态。

配套证据（都在源码里，值得亲手 grep）：

- `--dump-config` 与 boot 走**同一个** `applyEntryPatches` 调用——`include/src/index.ts` 注释原话 "so a dump can never drift from what boots"；
- dump 输出能给每行标注 `# == origin, patched by ...` 的来源链——只有"整行替换/整行插入"的算法才能做行对齐；
- 每次组合都 `structuredClone` 输入——patch 按引用 insert 的话，后续 id 定向 patch 会把值烤进缓存对象，"removing the override could never revert the row"。

## 精读三：错误要响亮

- `profile.ts` 的 `healProfilesModuleFallback`：BFS 遍历依赖闭包，在 `$DSH_HOME/profiles/node_modules` 建平面 symlink fallback，让 out-of-tree 插件共享**唯一** cordis 实例（两个 cordis 副本 = 类型与运行时双重灾难）。bundle 解析用双锚点（安装锚点优先），保证 in-box bundle 永远来自运行中 dsh 的同一安装。
- `app-boot/src/index.ts` 的 `installFailLoud`：unhandledRejection → 一行诊断 → 终端恢复 → `exit(1)`。静默吞错在这里是被禁止的。
- PENDING 行的诊断输出 `name: pending (waiting for services: X)`——依赖等待失败是有名字的诊断，不是超时（L01 讲过机制）。

## 上游实验

```bash
cd "$(./deepseek-harness-lessons/scripts/prepare_upstream.sh)"
# 对比三个产品的组装清单：哪些行被 web-app/headless 完整重述了？
diff <(grep "^- id:" packages/bundle/base/cordis.patch.yml) \
     <(grep "^- id:" packages/bundle/headless/cordis.patch.yml)
# 读 patch 算法的测试
ls vendor/include/tests/ 2>/dev/null || find . -path ./node_modules -prune -o -name "*.spec.ts" -print | grep -i include
# 找 dump 的来源标注实现
grep -n "origin, patched by\|renderConfigDump" packages/boot/app-boot/src/index.ts
```

## 这样设计买到了什么，付出什么

1. **"我的 dsh 到底在跑什么"永远有精确答案**——`--dump-config` 打印的就是 boot 的（同一条代码、同一份算法），且每行带来源链。常规做法里"配置漂移排查"这个工种在这里被结构性取消。
2. **回滚有定义**——去掉一层 patch 就精确回到没有它的状态（`structuredClone` 保证没有值被烤进缓存），"撤销"是可测试的性质而不是愿望。
3. **加一个产品 = 加一个 bundle 层**——web-app 与 headless 是同一套包上的两份组装清单，不是两个代码库（L10 会看到更多表面吃这个红利）。
4. **组合是事务**——`EntryGroup.update` 全量 diff + 失败回滚；patch "存在但解析失败"必须 throw，"落空"才 warn——misconfiguration 与 no-op 有明确分界，错误响亮（fail-loud）。

**代价**：整行替换要求覆盖者**重述全部字段**——bundle 作者改一行，所有覆盖这一行的 profile 都要跟着重述（上游把它写进 Known Limitations：这是用啰嗦换确定性）；来源链与平台门控也要求读者理解层栈模型，第一次读 `--dump-config` 输出需要 L00 的地图。

## 证据边界

- 本课讲锁定 SHA 的组合系统；`--dump-config` 的输出格式与 patch 词汇随上游演进可能变化。
- 不覆盖 Web 前端的 UI 组合（client plugins）与 preset 系统（课程十三 A03 专题）。
