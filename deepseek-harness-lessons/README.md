# 课程十二：DeepSeek Harness 实战通读——跑起来、改起来、再读懂它

> 锁定上游 `99f6f02`（`dsh@0.1.0-rc.7`，与课程十三共用同一 checkout）。约 4-5 小时 + 深读。

## 这门课是什么（2026-08 第三次重定义）

这门课改过两次方向：第一版给每课配"课程自造的模拟器"——学习者记住的是课程的玩具；第二版改成纯源码导读——学习者很快发现"那我直接读官方文档和源码就好，课程提供了什么？"。

两版的共同错误：**学习者全程在"读"，从没"做"**。第三次重定义把课程立在唯一站得住的位置上：**带你在一个真实 checkout 里把 dsh 用起来、扩展起来、拆装起来**——所有 lab 的命令与输出都被课程作者在同一 SHA 上真实跑通过。读完上游文档永远替代不了"亲手写一个 LLM adapter、看你的假模型驱动真循环跑完一个回合"的那一刻。

课程的四段路线：

| 段 | 内容 | 产出 |
|---|---|---|
| **跑起来** | 官方 first-plugin 路线：单文件插件 + 绝对路径 overlay | [labs/README](labs/README.md) 的环境准备 |
| **动手（核心）** | 6 个 lab：观察者插件 → scripted adapter（零 Key 驱动真实循环）→ 自己的工具 → 读日志 → 策略门 → 子代理 | [labs/](labs/) |
| **深读（参考层）** | 做完哪个 lab 读哪章：12 端源码导读，每章"常规做法会怎么坏 → 机制源码 → 买到什么/代价" | [deep-reading.md](deep-reading.md) |
| **毕业** | 在真实 checkout 里做一次完整扩展并过上游自己的测试 | [deep-reading/11-capstone.md](deep-reading/11-capstone.md) |

**两个关键设计**：

1. **零 API Key。** Lab 2 你会写一个 50 行的 scripted LLM adapter：模型是剧本的，循环、工具管线、会话日志、取消与配平全是真的。这与上游 keyless 测试 lane 的思路同构——不是模拟器（模拟器复刻系统行为；这里系统是真的，只有模型边界是可插拔的——这正是 dsh 自己的架构承诺）。
2. **每个 lab 都连回一个设计问题。** "为什么我的插件卸载是干净的"（注册即效应）、"为什么拒绝出现在 tool/result 里"（配平纪律）、"为什么子会话活过重启而 jobs 不"（声明过的恢复边界）——labs 制造体感，深读章节给论证。

## 快速开始

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git && cd deepseek-harness
git checkout --detach 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca
pnpm install --frozen-lockfile && pnpm run build
```

然后从 [labs/README.md](labs/README.md) 进入 Lab 1。

## 课程文件

```
labs/            6 个 lab 文档 + 参考插件源码（src/）+ overlay 模板（overlays/）
deep-reading.md  深读指南入口：系统级因果主线 + 按需读哪章
deep-reading/    12 章源码导读（参考层正文）
anchors.json     课程引用的全部源码锚点（维护设施，见下）
scripts/         上游快照准备与漂移检查（维护设施）
tests/           锚点校验的确定性测试（CI 用）
```

## 与课程十三的关系

课程十二建立"系统怎么工作、怎么扩展"的手感；[课程十三](../deepseek-harness-advanced-lessons/) 把八个**设计决策**变成案例研习——每个决策你能用上游自己的测试"破坏它看变红"。两门课共用同一锁定快照与同一个 checkout。

## 诚实边界

- 全部 lab 命令与输出在 `99f6f02`、Node 25、macOS arm64 上验证；其他平台路径与耗时可能不同。
- 零 Key 实验证明结构与机制，不证明任何 provider 的真实行为质量——真模型闭环见 `docs/testing.md` 的 real-API lane（上游自己的态度："do not ration real-API tests"）。
- 课程与 DeepSeek 官方无关；引用遵循 MIT，标注 path + SHA。
