# ADR 0004：AI 优先工具调用，保留文本 JSON 降级

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：AI 与前端团队

## 背景

早期 AI 绘图让模型直接输出 JSON，再由前端 `JSON.parse`。模型格式漂移、字段缺失或夹杂解释文字都会导致整次操作失败，且难以约束参数范围。

## 决策

后端把 CAD 工具定义（JSON Schema）随请求发送给支持的 Provider，模型通过 Function Calling 返回结构化工具调用；前端消费 SSE 中的 `toolCall` 事件并校验参数后执行。对于不支持工具调用的模型，保留文本 JSON 解析作为降级路径。

## 理由

- 工具调用的参数由 Schema 约束，格式错误率显著低于自由文本 JSON。
- 后端统一转换四种 Provider 的响应，前端只处理一种内部事件格式。
- 降级路径保证 Ollama 等能力较弱的模型仍可使用。
- 工具转换层是纯函数，可在没有 API Key 的情况下用固定样例做回归测试。

## 工具集

`draw_line`、`draw_polyline`、`draw_rectangle`、`draw_circle`、`draw_text`、`clear_canvas`、`delete_last`、`move_elements`、`rotate_elements`、`copy_elements`、`mirror_elements`。

## 后果

- 工具名与参数必须在前后端两处定义中保持同步（`lib/aiTools.ts` 与 `backend/src/services/aiEngine/tools.ts`）。
- 模型可能生成合法但不合理的参数（例如超大半径），前端仍需做业务校验。
- 工具调用与文本可能同时返回，需要定义优先级与展示方式。
- 后续引入“先预览后应用”时，应在命令层增加暂存态，而不是修改工具协议。

## 相关

- `lib/aiTools.ts`、`services/apiService.ts`
- `backend/src/services/aiEngine/tools.ts`、`backend/src/routes/llmChat.ts`
- `tests/aiTools.test.ts`、`backend/tests/toolCalls.test.ts`、`backend/tests/llmChatTools.test.ts`
