# L01：Cordis——插件、可逆生命周期与"没有全局状态"

> 本课问题：为什么「一切皆插件」不等于全局回调集合？插件怎样做到可装卸、可依赖等待、可 HMR？

"Everything is a plugin" 这句话谁都会说，难点在让它在工程上成立。Cordis（`vendor/cordis/src/`）用四个概念解决：**Context（作用域）、Service（服务）、typed events（事件）、Fiber（可逆生命周期）**。

## 常规做法会怎么坏：全局注册表的三种死法

几乎所有插件系统的第一版都是这样：

```ts
// 常规做法：全局注册表 + 回调集合
const handlers = new Map<string, Handler>()
export function registerTool(name: string, fn: Handler) {
  handlers.set(name, fn)          // 谁注册的？怎么撤销？
}
```

demo 阶段它工作。但"一切皆插件"意味着**模型适配器、工具、日志、循环本身**都要走这条路，于是三个坏情况迟早发生——dsh 为每一个都写了机制或测试：

1. **卸载与热重载留下垃圾。** 插件 A 注册了一个事件监听然后被禁用——`handlers` 里的条目还在，事件被处理两次，或者引用泄漏让进程慢慢膨胀。开发期 HMR 每保存一次文件就泄漏一批，几小时后系统不可用。Cordis 的回答是**注册即效应**：每个注册自动携带归属者与反序清理函数，卸载时框架代为回卷；"装卸 N 次后注册数回到基线"是上游测试的常规断言。
2. **依赖服务就绪的竞态。** 插件要用 `ctx.llm`，但 llm 插件还在加载——常规做法是 `setTimeout` 轮询或手工安排加载顺序，顺序成了隐藏的全局知识。Cordis 的回答是声明式 `inject` + epoch 重算：依赖集合一变，受影响的插件被可逆地重载，等待中的行有名字的诊断（`name: pending (waiting for services: X)`，见 L02）。
3. **归属不明导致"不敢卸载"。** 回答不了"这个注册是谁做的、谁负责撤销"，就永远不敢真的卸载任何东西——系统只增不减，"可替换"沦为口号。Proxy 化的 Context 让每次属性访问都带着 fiber 上下文，归属问题在机制层面有答案。

## 阅读地图

按顺序读，每个文件带着下面的问题读：

1. `vendor/cordis/src/context.ts` —— Context 到底是个什么对象？为什么是 Proxy 而不是继承体系？
2. `vendor/cordis/src/service.ts` —— 服务怎么声明、怎么注册？
3. `vendor/cordis/src/events.ts` —— 五种事件分发方式的差别？waterfall 的否决权意味着什么？
4. `vendor/cordis/src/fiber.ts` —— 插件应用的"可逆运行时"是什么？epoch 怎么重算？
5. `vendor/cordis/src/reflect.ts` —— 服务查找与依赖通知怎么实现？

## 精读一：Context 是 Proxy，不是继承体系

`context.ts` 的构造函数最后一行：

```ts
const self = new Proxy<this>(this, ReflectService.handler)
```

`new Context()` 返回的不是裸 this，而是一个代理：读 `ctx.xxx` 时沿 fiber 链向上找服务（`reflect.ts` 的属性拦截），找不到但声明过 inject 就抛错——错误原文在 `reflect.ts` 里搜 `cannot get required service`。类型面靠 declaration merging 扩展（`declare module './context.ts' { interface Context ... }`），业务包给自己的服务加类型，不改框架文件。

**为什么不做成"BasePlugin 类 + this.app 全局对象"？** 因为全局对象没有归属：你无法回答"这个注册是谁做的、谁负责撤销"。Proxy 方案让每次属性访问都带着 fiber 上下文，服务查找自然带作用域。

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

## 这样设计买到了什么，付出什么

1. **热重载与配置切换是安全的**——上面第 1 种死法（泄漏/双处理）被"注册即效应"结构性消灭，这是 profile 热重载、preset 组合（课程十三 A03）、HMR 能存在的前提。
2. **插件可以按任意顺序加载**——依赖等待是框架职责（inject + epoch），配置里写不出"加载顺序"，也就写不出顺序耦合（L02 的"行顺序无语义"直接依赖这一点）。
3. **per-agent 隔离成为可能**——每个 Agent 有自己的 `agent.ctx` 作用域，两个 agent 看到不同工具集、不同 provider，靠的就是"注册带归属、卸载会回卷"（L07 展开）。
4. **扩展点有否决权**——waterfall 让插件可以拦截并改写而不需要修改循环代码，这是 L03 的 `pre-step`、L06 的工具管线的地基。

**代价**：`ctx.xxx` 的属性访问是 Proxy 拦截，调试栈更深、心智模型不再是朴素 JS；服务是异步就绪的，写插件必须接受"依赖可能迟到"；对只要写一个工具的 casual 贡献者，这些概念是真实的入门成本——上游用 cookbook 与 declaration merging 的类型提示来摊薄它。

## 证据边界

- 本课讲的是 dsh 快照内 vendored 的 Cordis 副本；上游 Cordis 独立仓库可能已前进，结论只对本快照负责。
- 不深入 Cordis 论文的形式化理论；这里只学实现层面的运行时语义。
