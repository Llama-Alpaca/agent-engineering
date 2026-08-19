# L06 练习

1. 给课程 trace 增加 streaming finish 事件，验证 finish 后不能再出现 delta；在 claim 中说明它仍然不是 ACP transport snapshot。
2. 实现一个 session-log normalizer：只规范化允许变化的 request id、UUID、时间和临时 cwd，拒绝事件缺失、重排、非 JSON stdout 与未 scrub 的 request header。
3. 为一个真实插件写验证矩阵：unit、coverage、real composition、keyless snapshot、built entry、real API、Web browser；无法运行的项目必须写 `skip` 原因。
4. 比较 `complex-history.perf.ts` 与 `reasoning-chunks.stress.ts`：解释前者为什么不设时间阈值，而后者为什么能对固定浏览器 stress reproduction 使用 250 ms budget。
5. 构造“mock-green”反例：内存 fake 的 tool test 通过，但 published entry 丢失 plugin export。指出哪一条 Loader/built-artifact smoke 才能抓住它。

完成标准：所有课程 claim 都带 limitation；离线输出不会出现任何 `upstream lane: pass`；重复运行的 work-unit 行完全一致，但报告不把它叫作 latency benchmark。
