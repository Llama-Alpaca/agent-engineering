# L02 练习：源码作业

## 1. 追踪题：一次覆盖发生了什么

在 `vendor/include/src/index.ts` 的 `applyEntryPatches` 里，找到 patch 命中已有 id 的分支。回答：patch 只想改 `config` 里的一个字段时，旧 config 的其余字段去哪了？这个行为与 `packages/bundle/base/README.md` 的哪句话互相印证？

## 2. 对比题：三个产品差在哪

对比 `base`、`web-app`、`headless` 三份 `cordis.patch.yml`：

- 列出 headless 相对 base 完整重述的行（提示：`system-prompt`、`session-query` 一类）；
- 找出成对的平台门控行（`disabled: !!js ...`），解释"每个 host 恰好一个 shell 栈"是靠什么保证的；
- 回答：为什么这些差异行不放在 base 里用条件表达？

## 3. 追踪题：来源标注

从 `renderConfigDump`（`app-boot/src/index.ts`）找到 `# == origin, patched by ...` 风格的来源标注实现。它为什么只能建立在"整行替换/整行插入"的算法上？如果换成 deep merge，来源标注会出什么问题？

## 4. 阅读题：错配的防护

`applyEntryPatches` 对三种情况分别怎么处理：(a) patch 带了树里不存在的 id；(b) patch 的 `name` 与目标行不匹配；(c) patch 文件本身语法非法。引用代码，并回答哪一种是 warn、哪一种是 throw——分界线是什么？

## 5. 实验题：跑组合的测试

在快照里找 include/app-boot 的测试并读一个用例（`grep -rln "applyEntryPatches\|dump-config" --include="*.spec.ts" . | grep -v node_modules | head`）。它断言的不变量是什么？挑选一个"整行替换"的用例引用其断言。

## 6. 设计反思题

回想一个你维护过的配置系统（k8s manifests、django settings、.env 叠加……）：

- 它的"某字段最终值来自哪层"能一句话说清吗？
- 它的 dump/实际生效值是同一条代码算出来的吗？
- 用本课的三条思想（整行替换、dump 即 boot、行顺序无语义）各写一句"如果重来我会怎么改"。
