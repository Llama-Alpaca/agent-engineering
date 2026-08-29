# L01 练习：源码作业

## 1. 阅读题：注册的全是 effect

在 `vendor/cordis/src/` 里找出至少三处"注册类 API 底层调用 `fiber.effect`"的证据（提示：`reflect.ts` 的 provide 路径、`events.ts` 的事件注册、`service.ts` 的构造器末尾）。对每一处引用 `文件:行`，并回答：如果 `ctx.on` 不是 effect，HMR 卸载插件时会留下什么垃圾？

## 2. 追踪题：epoch 重载的完整路径

从 `Service` 注册（`reflect.ts` 的 `notify`）开始，追到一个依赖该服务的插件被 `_unload` 再 `_reload`。写出调用链上每个函数名。然后回答：服务 A 被新版本替换（旧 fiber dispose、新 fiber 起来）时，inject A 的插件的 epoch 分别在哪个瞬间变化？

## 3. 阅读题：五种分发的差别

读 `events.ts` 的类型与实现，填表：`emit` / `parallel` / `serial` / `bail` / `waterfall`——是否有序、能否改写值、能否中断、listener 抛错的后果。

## 4. 反例题：泄漏的插件

假设一个插件这样写：

```ts
export function apply(ctx: Context) {
  const timer = setInterval(() => ctx.logger.info('tick'), 1000)
  ctx.on('some/event', handler)
}
```

对照 `fiber.ts` 的 effect 收集逻辑，说明卸载这个插件后哪句话留下了垃圾、正确写法是什么（在上游源码或测试里找一个真实插件怎么包 effect 的例子并引用）。

## 5. 实验题：Cordis 的测试在保护什么

在快照里找 Cordis 或其使用者的 HMR/重复装卸测试（`grep -rn "HMR\|dispose.*leak\|回到基线" vendor/cordis packages --include="*.spec.ts" -l | head`），挑一个读它的断言：它证明的不变量是什么？为什么这个不变量对 dsh 的 profile 热重载是生死攸关的？

## 6. 设计反思题

你的项目里有没有"能装不能卸"的模块（单例注册、全局监听器、进程级缓存）？挑一个，写出把它改造成 effect/disposer 风格需要动的三处代码。
