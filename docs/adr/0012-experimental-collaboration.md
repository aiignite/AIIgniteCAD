# ADR 0012：实验性实时协作采用房间广播与最后写入胜

- **状态**：Accepted
- **日期**：2026-10-22
- **决策者**：前端 / 后端团队

## 背景

后端已具备 Socket.IO 房间与图元广播事件，但前端没有任何 socket 依赖，能力处于"半成品"状态：README 宣称的协作无法实际使用，同时匿名客户端可加入任意房间。设计计划要求协作方案二选一，并在一个迭代内收敛。

## 决策

1. 接通 Socket.IO 广播作为**实验性**协作能力，默认关闭，由状态栏「协作 实验」开关显式启用。
2. 采用**全员可写 + 最后写入胜**：客户端把本地提交与上次广播快照的差集作为补丁发送，远端按图元 id 覆盖合并。
3. 握手阶段校验 JWT；加入房间前校验项目归属（`userId` 且未软删除），广播只允许发往当前已加入的项目房间。
4. 补丁与光标在服务端做边界校验（条数、id/type、有限坐标），超限整包丢弃。
5. 远端补丁直接成为本地撤销基线，**不写入本地撤销历史**；协作会话态不写 IndexedDB。
6. 只有服务端已分配 UUID 的项目可加入；离线项目在同步完成前显示"尚未同步"。

## 备选方案

| 方案 | 结论 |
| --- | --- |
| CRDT（Yjs / Automerge） | 暂不引入：成本高，需要先验证多人协作需求 |
| 服务端操作日志 + 权威顺序 | 作为第二阶段候选，当前房间广播足够演示与小团队使用 |
| 保持半成品并从文档下架 | 不采用：已有后端事件与房间模型，接通成本更低 |

## 后果

- 并发编辑同一图元时后到者覆盖先到者，可能丢失一次修改；UI 明确标注"实验性"。
- 光标按 60ms 节流，仅用于在线提示，不参与文档状态。
- 反向代理需支持 WebSocket 升级；Socket 与 REST 同源（从 `VITE_API_URL` 取 origin）。
- 若后续升级为权威顺序或 CRDT，需新增 ADR 并替换 `services/collaborationService.ts` 的补丁通道。

## 相关

- `services/collaborationService.ts`、`hooks/useCollaboration.ts`、`store/collaboration.ts`
- `lib/collaboration.ts`、`backend/src/lib/collaborationProtocol.ts`
- `components/CollaborationToggle.tsx`、`components/RemoteCursors.tsx`
- [0003](0003-offline-first-sync.md)（离线同步的最后写入胜策略）
