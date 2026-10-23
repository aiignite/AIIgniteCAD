# ADR 0006：画布上下文摘要与 token / 延迟计量

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：AI 与可观测性团队

## 背景

AI 每次请求都附带完整画布 JSON 时，上下文长度随图元数量线性增长，既增加费用与延迟，也容易淹没真正相关的信息。同时，线上无法回答“一次请求用了多少 token、耗时多少、上下文有多大”。

## 决策

1. 前端统一使用 `lib/aiContext.ts` 的 `summarizeCanvasContext` 生成上下文：图元类型与图层统计、整体包围盒、最多 10 个选中图元的 id 与几何；不再拼接完整元素数组。
2. 助手通道把摘要放入 `[CONTEXT]` 段，系统模型通道放入 `CURRENT CANVAS CONTEXT` 段；两条路径都带选中集信息。
3. 前端通过 `telemetryService.reportClientInfo("ai.context-summary", …)` 上报 `elementCount`、`selectedCount`、`contextChars` 与估算 token。
4. 后端按 Provider 解析真实 usage（Ollama / Google / OpenAI / Anthropic）；缺失时按字符数 / 4 估算，并在日志中标记 `usageEstimated`。
5. 记录指标 `ai.tokens.prompt`、`ai.tokens.completion`、`ai.context_chars`，并保留 `ai.duration_ms`。
6. 日志脱敏对数值型 token 计数字段放行，避免指标被误打成 `[REDACTED]`。

## 理由

- 摘要保留了 AI 做空间决策所需的统计与选中细节，同时把上下文规模控制在与图元数量弱相关的量级。
- 真实 usage 优先、估算兜底，保证所有 Provider 都有可比较的计量。
- 客户端与后端两侧都有数据，可交叉验证上下文膨胀来自前端还是 Provider。

## 后果

- 摘要会丢失未选中图元的逐项几何；需要精确操作时必须先选中目标，或由用户明确描述。
- 字符数 / 4 只是近似，非英文与代码类内容的误差更大；`usageEstimated` 必须与真实值区分。
- token 字段名包含 “token”，脱敏规则需持续保证数值型计数不被屏蔽。
- 上下文摘要格式变化会影响 AI 输出质量，修改后需跑评测集。

## 相关

- `lib/aiContext.ts`、`components/RightPanel.tsx`、`services/telemetryService.ts`
- `backend/src/routes/llmChat.ts`、`backend/src/lib/logger.ts`
- `tests/aiContext.test.ts`、`backend/tests/llmChatTools.test.ts`
