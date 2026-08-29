# A05 练习：源码作业

## 1. 追踪题：一次 ask 的完整事件序列

从工具管线发出 `ask` 决策（课程十二 L06）到 `approval/decided` 落盘，按时序列出全部 durable 事件（含前置条件 hasOpenTurn 的检查）。回答：如果决出后进程崩溃在写 `approval/decided` 之前，reload 后这次 ask 在日志里长什么样？下游会不会把"问了没答"误读成"已批准"？

## 2. 阅读题：三种坏情况的归一

找到把 rogue 返回值与抛错的 answerer 都折叠成 `'unavailable'`的那段代码（注释里有 "closed-union switches"）。回答：如果让 rogue 值透传，调用方的 switch 会发生什么？为什么说这是"缝隙遏制自己的回调"？

## 3. 阅读题：变宽表与注意力经济

`WIDER_MODES` 怎样判定"这不是变宽"？列出两个"看起来是升级但表判为不变宽"的例子（同级别切换、 narrowing）。回答：为什么"不变宽就不问人"既是安全决策也是注意力决策？

## 4. 对比题：三种拒绝的语言

`FS_SANDBOX_DENIED`（结构化错误）、`denialSignatures`（方言匹配）、`SANDBOX_UNAVAILABLE`（fail-closed 端点）——分别对应什么层？为什么 in-process 围栏能给出结构化拒绝而 bash 沙箱要预注册方言？

## 5. 实验题：预设不产生第二真相

在 `permission-presets` 里追踪：选择 danger-full-access 后，`effectiveSandboxMode`/`effectiveApprovalPolicy` 从哪里 fold 出来？执行路径上有没有任何代码读"预设名"做决定？用 grep 证明。

## 6. 设计反思题

你的系统里"需要人工确认"的操作怎么处理无人值守场景（超时放行？跳过？排队？）。对照本课写三行：归一规则、审计对、fail-closed 端点各怎么落地。
