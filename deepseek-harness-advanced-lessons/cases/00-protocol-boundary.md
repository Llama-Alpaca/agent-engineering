# A00：协议边界的诚实设计——JSON-RPC 纯度与 ACP admission 事务

> 决策案例：用户在图片已落盘之后按下取消。此时系统面对两个坏选项——留下一个不可达的孤儿附件对象，或者把一条取消之后的用户消息塞进队列。上游选了前者，并把理由写进了注释。

## 阅读地图

1. `packages/sdk/protocol/src/transport.ts` —— 先看传输层的"纯度"纪律
2. `packages/acp/acp/src/content.ts` —— rc.7 新拆出的 admission 模块（rc.5 时还在 index.ts 里——这个拆分本身就是演进证据）
3. `packages/acp/acp/src/index.ts` —— 取消围栏与静默结算
4. `packages/acp/acp/tests/{turns,content,dispose,edges}.spec.ts` —— 边界行为的测试证据

## 案例一：stdout 只属于协议

SDK runtime 的进程模型把 stdout 完全留给 JSON-RPC 帧：诊断必须写 stderr（`transport.ts`）。传输层的三个"反直觉"事实（都是源码事实，不是 JSON-RPC 教材的想象）：

- 畸形 peer 行**直接忽略**（源码注释 "malformed peer lines are ignored"）——注意这与规范的 `-32700` 错误响应不同；
- 缺 request handler 回 `-32601`，handler 抛错回 `-32603`；
- notification 永远没有响应（没有 id 可回）。

**决策分析**：为什么忽略而不是报错？因为 NDJSON over stdio 的对端可能是正在启动、正在关闭、或混入了一行 shell 输出的进程——传输层的任务是**在脏字节流上保持帧同步**，不是当协议警察。把"语法错误"升级成错误响应反而会让对端状态机更混乱。而 ACP 侧的纯度更彻底：`apply` 直接把 stdio 接成协议流，"Stdout is reserved for protocol frames"——一条 print 调试语句就能杀死整个自动化客户端，所以这条纪律靠组合保证而非约定。

## 案例二：admission 是两遍式事务

`content.ts` 的 `admitAcpPrompt` 把一次带图 prompt 的入场做成事务：

1. **第一遍纯校验**（closed-union）：不认识的块类型直接拒；MIME 只接受 PNG/JPEG/WebP/GIF；base64 必须 RFC 4648 canonical（正则 + 重编码逐字节比对——防 padding 变体）；
2. **能力诚实**：`supportsAcpImagePrompts` 只有在 attachment 服务挂载、provider/model 可解析、模型输入模态显式含 image **全部成立**时才在 initialize 广播；任何未知一律按 false——客户端永远不会因为服务器夸口而发送注定被拒的图；
3. **整批落盘**：全部图片通过校验后才批量写入 content-addressed 存储；
4. **取消围栏**：落盘之后、`followup` 之前再做一次 abort 检查，且这次检查与入队之间**不允许任何 await**。

注释原文把取舍说透了："cancellation after a successful content-addressed write may leave an unreachable object but **never queues a late user message**"。孤儿附件是存储垃圾（可回收）；晚入队的消息是**协议语义错误**（取消之后还开了一个 turn）——垃圾可以容忍，语义错误不能。

## 案例三：结算等到真正静默

`index.ts` 的 `settleAfterQuiescence`（rc.5 叫 `settlePrompt`）：一次 prompt 的 stop reason 要等三道门全过才结算——admission 完成、agent `whenIdle()`、已排队的输出全部送达。配套决策：`cancel()` 只在消息已入队时才 `agent.cancel()`——**admission 不是 Agent 的工作**，为一条还没入队的 prompt 误杀正在跑的自主工作是不可接受的。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
git log --oneline -3   # 确认 99f6f02
# 读取消围栏的原话
grep -n "never queues a late user message" packages/acp/acp/src/content.ts
# 读 admission 的测试（挑 edges.spec.ts 的取消竞态用例）
grep -n "cancel\|abort" packages/acp/acp/tests/edges.spec.ts | head
# 对比 rc.5：admission 还没有独立文件
git show 47f9438:packages/acp/acp/src/ 2>/dev/null | head   # 无 content.ts
```

## 这样决策买到了什么，付出什么

1. **垃圾优于语义错误**：可回收的资源泄漏可以容忍，破坏协议语义的状态不能——两个坏选项放在一起时，先分类哪个可逆。落到本案例：孤儿附件是存储垃圾，GC 可以回收；晚入队的消息会让"取消之后还开了 turn"成为日志里永久的事实，重放、审计、用户信任全部受伤。
2. **能力只诚实广播**：广播前提是"可验证的全部成立"，未知按 false；客户端与服务器的契约建立在测试过的事实上——客户端永远不会因为服务器夸口而发送注定被拒的图。
3. **传输层管同步，协议层管语义**：忽略脏行是帧同步策略，错误码是语义响应——两个层次不要互相越权。
4. **进程边界即协议边界**：stdout 专用于帧的纪律靠组合（不靠开发者自觉）保证。

**代价**：两遍式 admission 意味着图片要完整缓冲、canonical base64 要重编码逐字节比对——大附件的入场延迟与 CPU 换来了"落盘即可信"；"孤儿附件可容忍"也意味着存储层需要（现在或将来）一个回收策略，上游把这笔债记在注释里而不是假装没有。

## 动手验证（在真实 checkout 里）

1. 把取舍原文找出来：`grep -n "never queues a late user message" packages/acp/acp/src/content.ts`——一行注释同时否决了另一个选项。
2. 跑执法测试：`pnpm vitest run packages/acp/acp --reporter=dot`，然后只用例名回答：取消竞态有哪几个专门用例？
3. 破坏实验（建议）：把 `admitAcpPrompt` 里"落盘后的取消检查"与 `followup` 之间塞一个 `await new Promise(r => setImmediate(r))`——预期 edges.spec 的取消用例变红。做完还原。

## 证据边界

- 全部引用对 `99f6f02` 负责；`-32700` 的对比是对 JSON-RPC 2.0 规范的一般描述。
- ACP 快照测试用录制会话回放，不证明真实客户端兼容性。
