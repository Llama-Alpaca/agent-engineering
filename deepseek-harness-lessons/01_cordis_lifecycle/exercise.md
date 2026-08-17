# L01 练习

## 练习 1：依赖断开

在第一次 provider 激活后调用它的 disposer，再发出 `tick`。确认 observer 不再收到事件，且 `observer/disposed` 先于下一次激活出现。回答：为什么不能只把 `ctx.on()` 的 disposer 存在一个全局数组里？

## 练习 2：比较 dispatch 模式

把第二个 `mode` listener 改成返回 `"bail"`，分别运行 `serial()` 和 `parallel()`。记录哪种模式会停止后续 listener，哪种模式会等待全部 listener。再把 listener 设为 async，观察 `emit()` 与 `parallel()` 的等待差异。

## 练习 3：故意漏掉 `next()`

让 `waterfall/short-circuit` 调用 `next()`，然后用 `strictWaterfall()` 运行。再撤掉调用，确认失败信息稳定包含 `did not call next()`。这对应真实 Cordis 中审批、`agent/request` 等 around 决策链的失败面。

## 练习 4：HMR 计数

把 hot plugin 的 `timer()` 注册移到 fiber 外，运行测试并观察 `resources.timers` 不再回到基线。修复它，并写一个断言锁住该回归。
