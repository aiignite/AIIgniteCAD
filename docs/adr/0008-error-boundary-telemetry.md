# ADR 0008：全局 ErrorBoundary 与客户端遥测

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：前端与可观测性团队

## 背景

渲染期异常会让整个编辑器变成白屏，用户既看不到原因，也没有恢复路径；线上偶发崩溃只能依赖用户口头描述。AI 上下文大小、同步积压等客户端状态也缺少上报渠道。

## 决策

1. 在应用根部挂载 `components/ErrorBoundary.tsx`，捕获渲染期异常并展示可操作出口：
   - **Try again**：清除错误状态，尝试重新渲染；
   - **Reload editor**：刷新页面；
   - **Copy error details**：复制错误消息、堆栈、组件栈、时间与 URL，便于提交 issue。
2. `services/telemetryService.ts` 统一采集：
   - `window.error` 与 `unhandledrejection`；
   - ErrorBoundary 捕获的渲染错误；
   - 同步错误与同步状态快照；
   - `client-info` 事件（AI 上下文统计等）。
3. 上报采用内存队列 + 批量发送：最多 100 条、每批 20 条、4 秒防抖；相同错误 60 秒内去重。
4. 遥测默认开启，可用 `VITE_TELEMETRY_DISABLED=true` 关闭；任何遥测异常都静默处理，不影响编辑与同步。
5. 上报内容不包含 API Key、Authorization 头、密码或完整请求体。

## 理由

- 渲染错误与异步错误需要不同捕获点，ErrorBoundary 只覆盖前者，全局监听补齐后者。
- 批量与去重避免错误风暴放大网络与后端压力。
- 可关闭开关满足隐私敏感部署。
- 遥测是 best-effort，不能成为新的故障源。

## 后果

- ErrorBoundary 不能捕获事件处理器、定时器与异步 Promise 中的异常，这些依赖全局监听。
- 60 秒去重可能掩盖同一错误的高频变化，排障时需结合后端日志。
- 队列未持久化，页面崩溃前的最后一批事件可能丢失。
- 遥测数据保留与访问控制由后端 `/api/telemetry/events` 负责，新增字段需继续遵守脱敏约束。

## 相关

- `components/ErrorBoundary.tsx`、`index.tsx`、`services/telemetryService.ts`
- `backend/src/routes/telemetry.ts`、`backend/src/middleware/observability.ts`
- `README.md` 可观测性章节
