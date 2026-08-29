# DeepSeek Harness 两门课程重新定义（2026-08-29）

## 结论

**推倒重做两门课的形态。** 课程十二从「源码精读 + 自造模拟器实验课」重新定义为**源码导读课**（读真实源码、学设计决策）；课程十三从「协议/产品的离线模拟课」重新定义为**设计决策案例课**（八个决策案例 + 三快照真实演进）。两门课的 20 节正文全部重写，每课自造的 300–870 行模拟实现全部删除，替换为锚点校验器（每课约 20 行）+ 锚点清单 + 源码作业。

## 为什么要重做：旧形态的审计结论

旧形态（2026-08-16 / 08-19 两次提交）每课交付一个「课程自有的确定性模拟实现」：`code.ts` 用几百行 TypeScript 复刻上游某子系统的行为，`tests/` 断言模拟器自己的输出。审计发现四个结构性问题：

1. **学习者全程不接触源码**。课程名叫「源码精读」，但功课是运行课程作者的复刻——学的是课程对上游的理解，不是上游本身。README 里的"源码事实"只在写课时对 SHA 核对过一次，之后与上游再无联系。
2. **绿测试不证明任何上游事实**。592 项测试里属于这两门课的部分，全部是"自造代码对自造预期"。模拟器与上游各自漂移时，测试永远绿——虚假的严谨。
3. **设计思想近乎缺席**。上游源码里成体系的决策语言（"registration is an effect"、"authorization — not secrecy"、"containment rather than a security boundary"、"do not ration real-API tests"）在旧课里只能以结论的形式零星出现，因为模拟器教学的主轴是"复刻行为"而不是"分析决策"。
4. **维护成本与价值倒挂**。20 个模拟器共约 11,500 行，上游每个 rc 都会让它们静默过期。

根因是执行偏离了原设计：`2026-08-16` 的设计文档明确要求课程 runner「把实验复制到固定 checkout 内、调用上游 pnpm/tsx，复用上游 workspace 解析」，实际实现却走了"零依赖离线模拟"的捷径，并把"keyless 可复现"这个手段当成了目的。

## 新形态

### 课程十二：DeepSeek Harness 源码精读——架构与设计思想（12 课，锁 `47f9438`）

- **材料是上游源码本身**。`scripts/prepare_upstream.sh` 检出锁定 SHA；每课 README 是导读：一个设计问题 → 阅读地图（按序文件 + 每个文件读什么）→ 带出处的源码精读 → 设计决策分析（问题/备选/取舍）→ 可迁移设计思想 → 在 checkout 里做的上游实验 → 证据边界。
- **作业是源码作业**：阅读题（答案在源码里、要求引用 `文件:符号`）、追踪题、改动-观察-还原题、设计反思题。
- **毕业课（L11）**改为在真实 checkout 的 `examples/` 里写一个小插件（human command / 观察者 / 最简工具三选一），用 `--patch` 挂载、跑上游测试验证、证明可拆卸，`git diff packages/core` 为空。

### 课程十三：DeepSeek Harness 设计决策专题——协议、所有权与演进（8 课，锁 `99f6f02`）

- 每课一个**决策案例**：面对什么问题 → 有哪些备选 → 选了什么 → 注释/测试里的原文证据 → 代价是什么。案例包括：取消赢得 admission 后"孤儿附件 vs 晚入队"（垃圾优于语义错误）、receipt-not-result（服务器拒绝归因）、三层投影分工、recompose 只许在无产出时（日志约束 API 形状）、authorization-not-secrecy、fail-closed 归一与成对审计、五条测试 lane 的"绝不证明"栏。
- **毕业课（A07）**做真实 drift 审计：`47f9438 → 99f6f02 → b150a551(master, 0.1.1-rc.2)` 三快照，用两门课的锚点校验器跑出存活/断裂清单，写消费者兼容矩阵与换锁建议。

### 锚点机制（两课共用）

每课 `anchors.json` 登记它引用的每个 `path` + `symbol`（标识符原文）或 `contains`（注释/错误文本原文）+ `note`（为什么值得看）。`common/study.ts` 提供共享校验器：

- **无 checkout（CI）**：校验材料自洽——anchors 合法、与 `source-manifest.json` 双向一致（清单路径 ↔ 锚点路径、清单符号 ↔ 锚点目标）、lesson id 与目录一致；打印本课阅读地图。
- **有 checkout（`DSH_SOURCE_DIR` 或课程缓存目录）**：对真实源码逐条复核锚点，任何一条 BROKEN 即非零退出。
- `check_upstream_drift.sh` 在原有的 SHA 与清单检查之后，**逐课跑锚点校验器**——漂移从"错觉"变成"信号"。
- 每课 `tests/check.test.ts` 用临时假 checkout 验证校验器逻辑本身（合法锚点全过、路径/符号/短语破坏必报）。

### 已核实的锚点事实

- 课程十二：81 个路径、12 课全部锚点（含符号与注释原文）在 `47f9438` 逐条 grep 核实后写入；实测对检出源码全绿。
- 课程十三：8 课 44 个锚点在 `99f6f02` 逐条核实；实测全绿。
- 漂移检测实证：把 checkout 切到 `99f6f02` 后跑课程十二 L10 的校验器，`settlePrompt` 锚点（rc.5 符号，rc.7 改名 `settleAfterQuiescence`）正确报 `BROKEN ANCHOR [missing-symbol]`——这正是旧形态永远做不到的检测。

## 课程叙事中沉淀的设计思想（新形态的核心产出）

课程十二每课收束 3–5 条、L11 汇总十条：注册即效应；配置即架构（整行替换换可解释性）；数据决定论；单一 append-only 真相 + 按受众投影；不变量要有运行时执法者；错误即事件、route on code；不可翻转的拒绝单独成类；缝隙三角色与诚实的能力事实；授权而非保密；receipt-not-result。课程十三每个案例回答"为什么这样选、付出什么代价"，并用三快照演进验证决策稳定性（核心不变量冻结、外围按压力生长）。

## 刻意保留的约束

- CI 保持离线、keyless、确定性：`run_tests.sh` 形态不变（12/8 课、每课 code.ts + tests），`.github/workflows/tests.yml` 无需改动。
- 证据边界纪律不变：离线校验只证明"课程引用的锚点存在且一致"，不证明上游能构建或真实模型可用；那些验证发生在检出 checkout 里，按每课 README 的上游实验进行。
- 锁定 SHA 不变（`47f9438` / `99f6f02`）；上游 master（`0.1.1-rc.2`）只作为 A07 的演进观察点，带日期，不作为课程基线。

## 交付清单

- `deepseek-harness-lessons/`：新 README、`common/study.ts`、12 课（README/anchors.json/code.ts/exercise.md/tests）、`source-manifest.json` 由 anchors 生成、drift 脚本增加锚点复核。
- `deepseek-harness-advanced-lessons/`：同构改造 8 课，复用课程十二的 `study.ts`。
- 根 `README.md` / `README.en.md`：两门课的定位、课表、可验证性说明、目录树更新。
- 本设计文档 + CHANGELOG。

## 验证

- `./deepseek-harness-lessons/scripts/run_tests.sh` → 12 课全绿；`./deepseek-harness-advanced-lessons/scripts/run_tests.sh` → 8 课全绿。
- `DSH_SOURCE_DIR=<checkout>` 下两门课全部 20 课逐课校验：12+44=56 个锚点对真实源码全绿。
- 两门课 `check_upstream_drift.sh` 端到端通过（含锚点复核段）。
- 跨快照负例：课程十二 L10 锚点在 `99f6f02` 上正确断裂（漂移检测有效）。
