# Lab 4：读日志——一份 append-only 真相能回答多少问题

**目标**：解开持久化的会话日志，亲眼确认 Lab 1-3 的一切都记了账。做完你会确切知道：日志的物理形态、事件如何对上官方时序图、以及为什么 fork/resume/审计/transcript 全都"免费"。

## 第 1 步：找到日志

```bash
ls -t $DSH_HOME/sessions/--path-encoded-cwd--/ | head -3
```

每个会话一个目录（目录名按 cwd 路径编码），里面是 `session.jsonl.zstd`——JSONL 流水 + zstd 压缩（会话里会有大量重复结构，压缩比很可观）。

## 第 2 步：解开读

```bash
f=$(ls -t $DSH_HOME/sessions/*/session.jsonl.zstd | head -1)
zstd -dc "$f" | head -1        # 会话头
zstd -dc "$f" | grep -o '"type":"[a-z/-]*"' | sort | uniq -c | sort -rn | head -12
```

真实输出（Lab 3 的那次会话）：

```text
{"type":"session","version":0,"id":"session-a07e084b-...","createdAt":1788010903360,"cwd":"/private/tmp/dsh-study","delegationDepth":0}

 56 "type":"string"        ← schema 描述（工具目录）
 29 "type":"object"
 10 "type":"assistant/chunk"
  4 "type":"user/message"
  2 "type":"usage"
  2 "type":"tool-call"
  2 "type":"step/start"
  2 "type":"step/end"
```

首行是**会话头**：id、cwd、`delegationDepth`（递归预算，Lab 6 会看到子会话这里是 1）。后面每行一个事件、严格 append-only。

## 第 3 步：对上官方时序图

打开 `docs/agent-lifecycle.md`，然后：

```bash
zstd -dc "$f" | grep -o '"type":"[a-z/-]*"' | grep -v '^{.*: "\(string\|object\|number\|boolean\|array\|text\)"' | head -40
```

你将看到 Lab 1 observer 打过的同一条序列（session/title、request/header、chunk、message、tool/call、tool/result、step/end、turn/end）——**observer 看到的 live 流与日志里的 durable 流是同一份事实的两个视角**。

## 第 4 步：三个"免费"能力的证据

1. **审计**：找到 `tool/result` 那行（`zstd -dc "$f" | grep '"tool/result"' | head -1`）。Lab 3 你返回的 `{head, dirtyCount, dirty}` 结构化 value 原样在账上——任何人任何时候都能重验。
2. **回放保真**：`assistant/chunk` 原始块都在（10 条）——token 级回放不依赖 message 的冻结结果。
3. **请求重建**：`request/header` + `request/context` 记录了模型、provider、采样参数。深读 04 章的 THEOREM 测试（"every request rebuilds byte-equal from the session log alone"）断言的就是：仅凭这份日志能重建每个请求。上游还给这条不变量配了**运行时执法者**（`packages/core/agent-loop/src/invariant.ts`）——每个请求过一遍断言，不是口号。

## 第 5 步（把不变性变成实验）

在 checkout 里跑上游自己的会话测试（真实验证过，全绿）：

```bash
pnpm vitest run packages/core/session --reporter=dot
```

然后做一个小实验回答："如果我在渲染 UI 时改了一条历史消息的内容，重放请求会怎样？"——不用真改，去读 `surface.ts` 的 replace 校验（`sourceEventSeqs` 必须完整覆盖被概括的原文）：**日志不给"悄悄改历史"留路径**，压缩摘要也要带出处。

## 回答三个问题再走

1. 压缩摘要替换掉模型视图里的旧内容后，用户看过的原文从哪找回？（深读 04 章 "deliberately shadows"。）
2. `delegationDepth: 0` 在会话头里意味着什么？谁会读到 1？
3. 为什么 `assistant/chunk`（过程）与 `assistant/message`（事实）要分开存？
