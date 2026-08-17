# L02：Profile、Bundle、Patch 与配置驱动组装

这节课研究“同一个 Agent spine 如何组装成 web/headless 产品”。真实源码锚点：

- `packages/boot/app-boot/src/profile.ts`：读取 profile manifest、按 bundle 顺序找到 patch 文件；
- `packages/bundle/base/cordis.patch.yml`：所有 profile 的基础插件行；
- `packages/bundle/web-app/cordis.patch.yml`、`packages/bundle/headless/cordis.patch.yml`：表面层替换；
- `packages/boot/app-boot/README.md`：Loader 与 patch-layer 约定。

本课用 `PatchLayer -> Composition -> Activation -> Loader` 四个纯数据阶段缩小真实流程，重点不是 YAML 语法，而是配置语义：

| 规则 | 实验中的证据 |
|---|---|
| 同 id patch 替换整行 config | `agent` 的 profile patch 明确重复 `mode` 与 `retry` |
| layer 顺序决定最终值，不能当启动顺序 | `agent` 行先出现，但要等 `llm/session` service 后才 active |
| 依赖缺失必须 pending | 缺 `credentials` 时 `llm` 与 `agent` 都不伪装成 active |
| schema 错误要响亮失败 | `maxSteps=0` 在 Loader 触碰旧树前抛错 |
| reload 先 dispose 旧实例再启动新实例 | `loader/dispose` 与 `loader/start` trace 可审计 |

## 跑实验

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 02
node --experimental-strip-types deepseek-harness-lessons/02_profile_bundle_composition/tests/composition.test.ts
```

实验无网络、无依赖、无 API Key。`naiveDeepMerge()` 是故意保留的反例：真实 patch 不是 deep merge；把它当成 merge 会让配置来源和行为悄悄偏离快照。

## 证据边界

离线 Loader 只模拟课程所需的 row replacement、schema、依赖和 reload，不会解析真实 `cordis.patch.yml` 或加载上游 package。要验证真实 CLI，需在 disposable checkout 使用锁定 SHA，并将 `dsh --dump-config` 输出与本课 trace 分开记录。
