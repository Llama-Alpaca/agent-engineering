# A02：投影的分层——Host Projection、客户端存储与窗口组装

> 决策案例：同一条"会话现在什么样"的真相，host 算一遍、客户端存一遍、窗口组装器再算一遍。三层冗余是浪费，还是各自回答了不同的问题？

## 阅读地图

1. `packages/session/session-projection/src/index.ts` —— host 侧投影的定义端
2. `packages/client/runtime/README.md` —— 客户端运行时的权威自述（先读它再读代码）
3. `packages/client/runtime/src/client/sessions/projection-store.ts` —— `ProjectionValueStore`
4. `packages/session/session-projection-cache/src/index.ts` —— 持久化投影缓存

## 案例：三层各自拥有什么

**第一层，host projection（服务端）**。`session-projection` 是一个标准 capability seam：`SessionProjectionMap` 是 merge-extensible 的投影类型表，包注册"我会从日志投影出 X"。host 在日志之上算出投影（todos、标题、统计……），它是**唯一有权从日志推导的地方**。

**第二层，客户端 store（`ProjectionValueStore`）**。每个客户端 `Session` 持有一个通用投影存储：从 history-tail 的 `projections` 块播种，之后由 `session/projection` 推送帧驱动更新。更新规则只有一条——**higher-seq-wins**：新 seq 覆盖旧 seq，**stale baseline 永远不能覆盖新帧**（对应的测试注释就叫 "a stale baseline cannot overwrite a…"）。

**第三层，窗口组装**。`SessionRuntime` 拥有"共享事件窗口 + 历史分页"：会话视图不持有全部事件，而是持有当前窗口；向上翻页时向前插入更早的事件，同时保持节点 identity（同一事件在窗口移动前后是同一个对象）。

## 决策分析：为什么三层而不是一层

假设只有一层会发生什么：

- **只有 host 投影**：客户端每次渲染都要一趟往返；断线期间界面冻结；
- **只有客户端 store**：每个客户端自己从原始日志重算投影——计算重复 N 份，且不同语言客户端必然算出分歧（A01 的十字检查会永远红）；
- **只有窗口组装器**：投影值（标题、todo 状态）没有家，每次滚动重算。

三层的分工本质是**按数据的生命周期分层**：日志是无限事实流（host 拥有推导权）；投影值是小而有状态的现状（客户端缓存，seq 定序）；窗口是纯视图问题（分页与 identity）。higher-seq-wins 是唯一需要的并发协议——因为 host 已经保证投影帧的 seq 单调，客户端不需要理解投影内容就能正确收敛。

一个精致的细节：`ISession.rename` 从 unary 响应直接结算 `title` 投影格（带 seq），推送帧后到时重放同一 seq 是 no-op——**乐观更新与服务器真相用同一条 seq 规则合并**，不需要专门的"待确认"状态。

## 上游实验

```bash
cd "$(./deepseek-harness-advanced-lessons/scripts/prepare_upstream.sh)"
# 客户端运行时自述（本课最重要的单文件阅读）
sed -n '1,40p' packages/client/runtime/README.md
# higher-seq-wins 的两条路径（推送帧 vs unary 响应）
grep -rn "higher-seq-wins" packages/client/runtime/tests/*.spec.ts | head -3
# host 侧投影的注册形态
sed -n '1,30p' packages/session/session-projection/src/index.ts
```

## 设计思想

1. **按数据生命周期分层，而不是按"谁更强"分层**：无限事实流 / 小状态现状 / 纯视图，各自找拥有者。
2. **单调 seq 是最便宜的并发协议**：客户端不理解投影语义也能正确合并——收一个单调序数，比实现任何 CRDT 都便宜。
3. **乐观更新与服务器真相共用一条规则**：没有"待确认"状态机，同一 seq 自然幂等。
4. **推导权唯一**：从日志算投影只发生在 host 一处；客户端只消费结果，两语言客户端不产生分歧。

## 证据边界

- 本课引用 `packages/client/runtime` 的 README 与测试注释；Web UI 的渲染细节（React 组件层）不在范围。
- 窗口分页的具体交互行为以 client 包测试为准，本课只讲 identity 与分层的结构。
