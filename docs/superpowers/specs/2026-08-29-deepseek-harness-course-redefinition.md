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

## 追加修订（2026-08-29 第二轮）：why 优先的叙事结构

第一轮交付后用户反馈：课程"没能说明 dsh 为什么这样设计、这样设计的好处是什么"，仍有泛泛而谈之处。诊断：课程十二多数课从机制切入（"claim 只有 6 行……"），课末「设计思想」是格言式结论的罗列——缺"常规做法 → 会怎么坏 → dsh 的选择 → 买到什么/代价"的论证链；两门课也缺一条系统级因果主线。第二轮修订：

1. **课程十二每课**（L00–L11）：在阅读地图前新增核心段「常规做法会怎么坏」——先摆业界直觉做法（常带 3–6 行示意代码），走 2–4 个具体失败场景，每个场景都能指到上游为它写的测试用例名、运行时 invariant 或注释原文；课末「设计思想」改为「这样设计买到了什么，付出什么」，收益逐条落到具体能力/证据，并新增「代价」小节诚实计账。
2. **两门课 README 各加设计主线**：课程十二加「设计主线：这个系统为什么长这样」（四根支柱以周为单位变化 → 凡是会变的都是插件 → 四个工程问题的答案链表格）；课程十三加「八个决策背后的共同压力」（不可消除的坏情况 → 「哪种坏可逆」方法论表）。
3. **课程十三 A00–A07**：节名统一为「这样决策买到了什么，付出什么」，每课补「代价」块（第一轮只有收益没有成本）。
4. 根 README.md / README.en.md 两门课引言改写为 why-first 表述；CHANGELOG 记录。

约束不变：锚点集合与锁定 SHA 不动（新叙事引用的源码事实全部已有验证锚点背书或为已核实的推理叙述）；CI 形态不变。


## 第三轮修订（同日晚）：从导读课到动手课

用户复审第二轮后给出根本性判断："看了这两个课程能学到啥？别人根本没必要看这个课程，还不如去看源码。"诊断成立：第二轮产出是"带批注的阅读顺序"，而上游 docs/architecture.md + cookbook 本身已是优秀阅读顺序；课程没有提供源码与官方文档之外的价值增量，学习者全程在"读"、从未在"做"；每课 anchors/code.ts/tests 是课程作者的维护工具而非学习者收获。第三轮决策：

1. **价值定位**：课程 = 带你把 dsh 用起来、扩展起来、拆装起来 + 把设计决策变成可亲手验证的事实。lab 必须真机验证后才能写进课程（作者环境：rc.7 checkout、Node 25、macOS arm64，`pnpm install --frozen-lockfile` 46s、`pnpm run build` 分钟级）。
2. **零 Key 方案**：scripted LlmAdapter（50 行）注册 `lab-scripted` provider 路由——模型是剧本的，循环/工具管线/会话/取消配平全是真的；与上游 keyless snapshot lane 同构，不是模拟器（模拟器复刻系统，此处系统是真的、只有模型边界可插拔——正是 dsh 的架构承诺）。已验证：完整回合（34 条 durable 事件、真实 bash 工具调用、两个 step）。
3. **形态革命**：删除两课全部"每课五件套"目录（20 个）；课程十二 = README + labs/（6 lab 文档 + 参考插件源码 + overlay 模板）+ deep-reading/（旧课文 12 篇精华迁移）+ 课程级 anchors.json；课程十三 = README + cases/（8 案例统一工序）+ 课程级 anchors.json。锚点机制保留为维护设施（drift 检测价值真实），但从学习路径上退场。
4. **break-it 实验法**（课程十三招牌）：跑上游执法测试（绿）→ 临时删掉决策 → 看哪个测试变红 → 还原。A05 全流程实测；标注"实测"的都执行过，"建议"未执行（诚实分层）。
5. **统一快照**：两课锁 99f6f02；课程十二 82 锚点对 rc.7 复核（唯一漂移 settlePrompt→settleAfterQuiescence 修正并注记）。
6. **lab 工程事实**（排错清单全部真实踩坑）：插件可用单文件绝对路径挂载（官方 first-plugin 教程模式，放 examples/ 下沿 node_modules 解析 @deepseek-ai/*）；`$DSH_HOME/settings.yaml` 的 agent-default-model 保存选择**优先于组合行**（真实踩坑，转为教材）；overlay 行 id 与 base 撞名会 fail-loud；`dsh plugin add <path>` 是第三方真实分发路径（pnpm 转发器 + bundle reconcile，实测）。
7. 验证：两课 run_tests.sh 全绿；82+44 锚点对 rc.7 checkout 逐条复核全绿；6 个 lab 端到端真机执行；A05 break-it 全流程执行并还原（user-approval 套件终态 38 绿，源码已还原）。
