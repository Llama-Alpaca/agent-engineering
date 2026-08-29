# L01：Cordis——插件、服务与可逆生命周期

> 本课问题：为什么「一切皆插件」不等于全局回调集合？插件怎样做到可装卸、可依赖等待、可 HMR？

"Everything is a plugin" 这句话谁都会说，难点在让它在工程上成立：插件要能按任意顺序加载、能依赖别人提供的服务、能被卸载且**不留任何垃圾**、能在依赖变化时自动重载。Cordis（`vendor/cordis/src/`）用四个概念解决：**Context（作用域）、Service（服务）、typed events（事件）、Fiber（可逆生命周期）**。

## 阅读地图

按顺序读，每个文件带着下面的问题读：

1. `vendor/cordis/src/context.ts` —— Context 到底是个什么对象？
2. `vendor/cordis/src/service.ts` —— 服务怎么声明、怎么注册？
3. `vendor/cordis/src/events.ts` —— 五种事件分发方式的差别？
4. `vendor/cordis/src/fiber.ts` —— 插件应用的"可逆运行时"是什么？
5. `vendor/cordis/src/reflect.ts` —— 服务查找与依赖通知怎么实现？

## 精读一：Context 是 Proxy，不是继承体系

`context.ts` 的构造函数最后一行：

```ts
const self = new Proxy<this>(this, ReflectService.handler)
```

`new Context()` 返回的不是裸 this，而是一个代理：读 `ctx.xxx` 时沿 fiber 链向上找服务（`reflect.ts` 的属性拦截），找不到但声明过 inject 就抛错——错误原文在 `reflect.ts` 里搜 `cannot get required service`。类型面靠 declaration merging 扩展（`declare module './context.ts' { interface Context ... }`），业务包给自己的服务加类型，不改框架文件。

**设计决策**：为什么不做成"BasePlugin 类 + this.app 全局对象"？因为全局对象没有归属：你无法回答"这个注册是谁做的、谁负责撤销"。Proxy 方案让每次属性访问都带着 fiber 上下文，服务查找自然带作用域。

## 精读二：注册是 effect，卸载自动回卷

Fiber 是"一次插件应用"的可逆运行时，状态机是 `FiberState`（PENDING → LOADING → ACTIVE → … → DISPOSED）。两个关键机制：

**effect/disposer**：`ctx.fiber.effect(fn)` 运行 fn、收集它返回的清理函数，dispose 时反序执行——`fiber.ts` 里搜 `disposables.splice(0).reverse()`。关键在于**所有注册类 API 底层都是 effect**：`ctx.provide` 是 effect（`reflect.ts`），`ctx.on` 是 effect（`events.ts`），`Service` 构造器的最后一句就是 `ctx.reflect.provide(name, self, ...)`。所以插件作者写"启动逻辑"，框架负责"拆卸逻辑"。

**epoch 重载**：`fiber.ts` 的 `_refresh()` 把每个 inject 服务的提供者 fiber uid 拼成 epoch 字符串；任何一个服务下线/上线都会改变 epoch，触发 `_unload()`/`_reload()`。插件不需要写"依赖服务重启了怎么办"——依赖集合的任何变化都由框架可逆地处理。

## 精读三：waterfall——有否决权的有序链

`events.ts` 定义五种分发：`emit`（通知）、`parallel`、`serial`、`bail`、`waterfall`。**waterfall** 是带顺序与委托的：listener 不调用 `next()` 就是否决（短路）。后面 L03/L06 会看到 `agent/pre-step`、`tools/execute` 都是 waterfall——扩展点不是"钩子数组"，是"可以改写参数、可以否决的链"。

## 上游实验（在快照里做）

```bash
# 数一数 Cordis 自己有多少测试、测的是什么不变量
ls vendor/cordis/tests/ 2>/dev/null || find vendor/cordis -name "*.spec.ts" | head
# 找到所有"注册类 API"的 effect 化证据
grep -n "fiber.effect" vendor/cordis/src/reflect.ts vendor/cordis/src/events.ts
# 亲手追一遍 epoch
grep -n "_refresh\|_setEpoch" vendor/cordis/src/fiber.ts
```

可选（需要 `pnpm install`）：`pnpm vitest run vendor/cordis --reporter=dot`，看 Cordis 的测试全绿需要多久。

## 设计思想

1. **注册即效应，不是全局副作用**。每个注册都有归属者与反序 disposer——这是"一切皆插件"能成立的前提，也是 HMR、profile 热重载、服务热插拔的正确 teardown 的来源。
2. **依赖等待是声明式的**。`inject` 声明 + epoch 重算让"等服务"变成框架职责；未声明就读服务直接抛错，隐式全局单例从类型层面被挤掉。
3. **可逆性是组合性的另一半**。能装不能卸的插件系统会在 HMR 与配置热重载下泄漏到不可用；"重复装卸后注册数回到基线"是上游测试的常规断言。
4. **扩展点是带否决权的有序链（waterfall）**，不是无序回调集合——顺序与委托让"拦截并改写"成为一等能力。

## 证据边界

- 本课讲的是 dsh 快照内 vendored 的 Cordis 副本；上游 Cordis 独立仓库可能已前进，结论只对本快照负责。
- 不深入 Cordis 论文的形式化理论；这里只学实现层面的运行时语义。
