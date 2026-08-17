# L01：Cordis 插件、服务、事件与可逆生命周期

DeepSeek Harness 的 `Cordis` 不是一组全局 callback。真实源码的四个锚点是：

- `vendor/cordis/src/context.ts`：Context、插件树和服务可见性；
- `vendor/cordis/src/service.ts`：Service 的注册与 owner fiber；
- `vendor/cordis/src/events.ts`：`emit`、`parallel`、`serial`、`waterfall`；
- `vendor/cordis/src/fiber.ts`：状态、effect disposer、卸载和依赖等待。
- `docs/cordis-primer.md`：Harness 如何把这些原语组合成插件树。

本课 `code.ts` 是同构但缩小的实现，刻意保留四条可迁移不变量：

1. `inject()` 在依赖缺失时保持 pending；服务出现后才激活。
2. 服务 owner 消失会卸载依赖插件，服务恢复可重新激活。
3. listener、timer、service 都挂在 Fiber 的 disposer 上；重复装卸后计数回到基线。
4. `waterfall` 是 around 链；漏调 `next()` 会短路，而不是悄悄继续。

## 跑实验

```bash
./deepseek-harness-lessons/scripts/run_lesson.sh 01
node --experimental-strip-types deepseek-harness-lessons/01_cordis_lifecycle/tests/lifecycle.test.ts
```

输出包含依赖激活 trace、四种 dispatch 的调用顺序、waterfall 短路，以及 HMR 循环后的资源计数。没有真实 timer、网络或 API Key；timer 是可计数的逻辑资源，避免测试依赖墙钟时间。

## 与快照的边界

快照中的 `Fiber` 还有 config schema、状态机、async effect、HMR 和错误聚合；离线模型只验证课程需要的生命周期核心。不要把这个 `Context` 当成上游 API 替代品，也不要用 mock 结果证明上游插件已经安装成功。
