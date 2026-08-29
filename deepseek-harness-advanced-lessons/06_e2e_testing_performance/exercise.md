# A06 练习：源码作业

## 1. 阅读题：五条 lane 的"绝不证明"栏

`docs/testing.md` 读完后，不看本课 README，自己重填"绝不证明"列。对照补齐。然后回答：为什么"绝不证明"栏比"证明"栏更难写、也更重要？

## 2. 追踪题：一次 snapshot 回放跑了什么

从 `test:snapshot` 入口追进去：它启动了什么真实进程（构建产物里的哪个示例）、回放了什么 fixture、断言了什么（system-prompt/tool-schema 钉死在哪）。回答：这条 lane 怎么覆盖"mock 全绿、发布入口失败"的负例？

## 3. 阅读题：replay 只读的 enforcement

`ci.yml` 里 `DSH_SNAPSHOT` 怎么被强制？本地开发者怎么显式录制新基准（找文档或脚本入口）？写出一个"如果 CI 允许写基准"的具体事故链。

## 4. 思考题：skipped-as-success 的边界

e2e 的 fork/Dependabot PR 用 job 级 `if:` 让 skip 报 successful。回答：这个豁免为什么不能推广到"所有没 key 的 PR"？如果推广了，哪类回归会永远看不到？

## 5. 实验题：给自己的项目画 lane

画你项目的测试分层表（几条 lane、各自证明/绝不证明什么）。如果只有一条 lane（全 unit），按本课五条的模式补两条最缺的（提示：real-composition 与发布形态 smoke 通常最缺）。

## 6. 对比题（连回课程十二 L10）

课程十二 L10 说"keyless 与 real-API 结论分栏不混报"；本课说"do not ration"。这两个态度矛盾吗？各用一句话说明它们守的是哪条不同的底线。
