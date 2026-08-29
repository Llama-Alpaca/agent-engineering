# L02：Profile、Bundle 与 Patch——配置即架构

> 本课问题：Web、headless 和自定义部署如何从同一套 package 组装出来？为什么 patch 是整行替换而不是 deep merge？

L01 说了"一切皆插件"，但插件从哪来、以什么组合跑起来？答案不在代码里，在**组合系统**里：一个运行中的 dsh = 一棵由配置组装出的插件树。

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

## 设计思想

1. **可解释性优先于便利性**。整行替换写起来啰嗦（要重述全部字段），换来的是每个值的来源可追溯、回滚语义明确——上游把这个取舍写进 Known Limitations 而不是用 merge 魔法掩盖。
2. **所见即所挂载**。dump 与 boot 共享同一条组合代码，是"配置即架构"可信的前提。
3. **组合是事务**。`EntryGroup.update` 全量 diff + 失败回滚；patch "存在但解析失败"必须 throw，"落空"才 warn——misconfiguration 与 no-op 有明确分界。
4. **行顺序无语义**。加载顺序由服务依赖图决定，配置里写不出"启动顺序"，也就写不出顺序耦合。

## 证据边界

- 本课讲锁定 SHA 的组合系统；`--dump-config` 的输出格式与 patch 词汇随上游演进可能变化。
- 不覆盖 Web 前端的 UI 组合（client plugins）与 preset 系统（课程十三 L03 专题）。
