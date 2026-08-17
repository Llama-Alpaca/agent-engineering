# L02 练习

## 练习 1：整行替换

把 `layers.profile` 的 `agent` patch 改成只包含 `{ maxSteps: 12 }`，运行实验。观察 validator 如何指出 `mode` 缺失。再把 validator 暂时关掉，比较最终配置与 `naiveDeepMerge()` 的差异，解释为什么“帮忙补字段”反而掩盖了来源错误。

## 练习 2：反转 row 顺序

把 `demoLayers().base.rows` 中 `agent` 放到最后、再放回第一行。比较 `activationOrder`：它应由 service 可用性决定，而不是数组行号决定。

## 练习 3：缺失服务诊断

将 `resolveActivation(..., ["http"])` 改成空数组，列出每个 pending row 的 `missing` 集合。新增一个 `credentials` row 并让它提供该 service，确认 fixed-point resolver 会继续激活 `llm`，随后激活 `agent`。

## 练习 4：失败 reload

先成功 `loader.load()`，再提交非法 overlay。验证 `load()` 抛错后旧 composition 仍可被 `dispose()`，而不是半卸载状态。这个“先验证、后替换”边界是 HMR 安全的基础。
