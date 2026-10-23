# ADR 0011：视图类工具绕过 AI 变更预览

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：AI 与 CAD 团队

## 背景

ADR 0005 规定所有 AI 动作都要先经 `computeAIActionOutcome` 计算、再由 `AIPreviewModal` 展示，确认后一次 `commitAction` 写入画布。这条规则的目的是让用户在写入前看到"将新增/修改/删除多少图元"，避免误删与不可逆操作。

第三包引入 `zoom_to_selection` 后出现一类新动作：它只改变视口，既不新增也不修改图元。这类动作如果沿用预览链路，会出现两个问题：一是预览弹窗只能显示"无图元变化"，用户看到的是一次没有信息量的确认；二是视口属于瞬时视图状态（见视口外部 store），不是文档内容，把它写进文档会污染脏标记并凭空产生撤销步骤，而用户并不认为"看一眼放大"是一次编辑。

## 决策

1. **显式分类**：视图类工具在 `lib/aiTools.ts` 中以 `VIEW_TOOL_NAMES` 单独登记（当前只有 `zoom_to_selection`），并导出 `isViewTool(name)`。它与 `READ_ONLY_TOOL_NAMES`（`get_canvas_info`）的区别是：只读工具无副作用，视图工具有副作用（移动视口），因此不能混为一类。
2. **不进画布动作**：视图类工具不产生 `AIActionResponse`，而是由 `toolCallToViewRequest(call, { elements, selectedIds })` 转换为 `AIViewRequest { bounds, summary }`；没有可作用目标时返回 `null`，该调用按失败回传原因。
3. **独立通道执行**：`lib/aiAgentLoop.ts` 的 `applyToolCalls` 把视图请求收集到 `RoundOutcome.viewRequests`，由 `hooks/useAIChat.ts` 在每轮结束后调用 `store/viewport.ts` 的 `zoomViewportToBounds` 执行。草稿的 `actions` 保持为空，因此该轮不会产生预览弹窗、不会 `commitAction`、不会占用撤销步骤、不会把文档标记为脏。
4. **服务端仍需目标**：后端 `toolValidator.ts` 把 `zoom_to_selection` 放进 `TARGET_TOOLS`——省略 `ids` 时用当前选择集补齐，两者都为空则拒绝（`NO_TARGET`）。"缩放到全部"没有意义，拒绝比默默失败更容易让模型自我修正。
5. **提示词显式说明**：`generateToolSystemPrompt` 与 `promptComposer.ts` 的执行语义段落都写明该工具只改变视口、无需确认，避免模型反复索取确认或误以为需要预览。
6. **例外是白名单式的**：只有登记在 `VIEW_TOOL_NAMES` 的工具能走这条路径。新增视图工具必须同时更新前端白名单与后端工具定义；白名单之外的动作一律回到 ADR 0005 的预览流程。

## 理由

- 预览解决的是"写入前可见"，而视口变化不写画布、没有可预览的图元差异，确认步骤只增加摩擦而不增加安全。
- 视口是瞬时状态，用户随时可以滚轮缩放或按 `Z` 键回到全图，误缩放的后果远低于误删除，恢复成本几乎为零。
- 把视图请求放在 `RoundOutcome` 而不是草稿里，可以保证 `draft.actions` 仍然只描述画布变更，前端的"有变更才弹预览"逻辑不需要新增分支。
- 服务端仍然要求目标，避免模型生成"缩放到不存在的对象"这类无意义调用。

## 后果

- 只包含视图工具的一轮不会出现预览弹窗；聊天时间线里以工具卡片显示"缩放到 N 个图元"，用户需要自己观察视口变化。
- 一轮里同时有视图工具与写工具时，写工具仍走预览；视口在预览弹出前就已移动，用户取消预览不会把视口恢复原状——视口本来就不属于可撤销的文档变更。
- 视图类工具不受撤销历史保护，也不写入同步队列；把它当成"操作图纸"会落空。
- 前后端的视图工具白名单必须保持一致，否则模型可能调用前端不认识的工具，前端会以错误回传而不是静默忽略。
- 视图请求只基于目标包围盒，不做"适配后仍然太小"之类的细节处理；需要精细取景时由 `ZOOM` / `VIEW` 命令负责。

## 相关

- `lib/aiTools.ts`、`lib/aiAgentLoop.ts`、`hooks/useAIChat.ts`、`store/viewport.ts`
- `backend/src/services/aiEngine/tools.ts`、`backend/src/services/aiEngine/toolValidator.ts`、`backend/src/services/aiEngine/promptComposer.ts`
- `tests/aiTools.test.ts`、`tests/aiAgentLoop.test.ts`、`backend/tests/toolValidation.test.ts`
- [ADR 0005](0005-ai-preview-single-undo.md)、[ADR 0010](0010-ai-agent-core-loop.md)
