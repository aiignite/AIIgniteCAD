# ADR 0014：设计操作工具、计划模式与图纸检查面板

- 状态：已采纳
- 日期：2026-10-22
- 相关：ADR 0004（AI 工具调用）、ADR 0005（AI 预览单步撤销）、ADR 0010（Agent 循环）、ADR 0013（技能与只读工具）

## 背景

只读工具让模型能“看见”图纸，但设计过程仍缺三件事：

1. 常用整理动作（对齐、等距分布、连续标注、改图层、按 id 删除）只能拆成移动/复制等低层工具，
   模型要自己算坐标，容易累积误差。
2. 多步骤请求（“画三根线，标注并整理”）一旦直接进入写工具循环，用户只能在最后看到结果，
   无法在执行前调整顺序或删掉不需要的步骤。
3. `check_drawing` 的问题只在模型回答里出现，用户没有一个常驻、可定位、可忽略的检查视图。

## 决策

### 1. 设计操作复用现有动作管线

- 新增 `align_elements` / `distribute_elements` / `dimension_chain` / `assign_layer` / `delete_elements`。
- 纯几何实现放在 `lib/designOps.ts`，AI 动作在 `lib/aiActions.ts` 中转换为 `ALIGN` / `DISTRIBUTE` /
  `SET_LAYER` / `DELETE`，仍由 `computeAIActionOutcome` 计算差分。
- 因此新工具自动继承预览、单步撤销、破坏性操作确认与非法参数拒绝，不新增写图通道。
- 对齐至少 2 个目标、分布至少 3 个；间隙为负时返回失败而不是挤压图元。

### 2. 计划模式是“先提案、后本地执行”

- 前端用 `shouldProposePlan` 判断复杂度：显式规划词、跨 3 类操作，或 ≥80 图元且选中 ≥3 个的整理请求。
- 命中后请求携带 `planMode`，后端本轮只下发 4 个只读工具与 `propose_plan`，系统提示词注入计划规则；
  模型不能绕过计划直接写画布。
- `propose_plan` 是控制工具，不属于 CAD 工具白名单；计划步骤里的 `tool` 必须是真实 CAD 工具，
  参数受体积上限约束。服务端 `toolValidator` 拒绝未知步骤工具、空目标、超长列表与非法参数。
- 计划卡片允许改标题、上下移、删除步骤。确认后 `planToToolCalls` 过滤只读/视图/未知工具，
  在**当前图纸**上重新执行 `applyToolCalls`，失败时标记为“未能执行”；成功则走一次
  `AIPreviewModal` 与一次 `commitAction`，不额外请求模型。
- 选择“计划里携带具体工具与参数”而不是“确认后再问模型”，避免多一轮模型延迟与新的协议状态；
  代价是计划可能在用户确认前过期，由本地重新求值与失败状态兜底。

### 3. 检查面板复用确定性规则

- `reviewDrawing` 增加文字重叠（交集面积占较小文本框 ≥60%）与“成图全部位于图层 0”的整理提示。
  规则纯函数、可复现，不依赖模型。
- `DrawingReviewPanel` 提供严重级别筛选、定位、单条忽略、恢复忽略与“让 AI 修复”。
- 定位只改选择集与视口，不写图纸、不占撤销。
- “让 AI 修复”生成问题摘要（标题、级别、相关图元 id），预选相关图元后切到对话；
  不发送完整图元 JSON，也不自动执行修复。

## 后果

- 模型能表达更高层的设计意图，但多出计划确认步骤；单步绘图/编辑不会触发，避免打扰。
- 计划与检查规则都在前后端有测试：`tests/aiPlan.test.ts`、`tests/aiAgentLoop.test.ts`、
  `backend/tests/toolValidation.test.ts`、`backend/tests/llmChatTools.test.ts`、`tests/designTools.test.ts`。
- 新工具名必须同步 `backend/src/services/aiEngine/tools.ts`、`lib/aiTools.ts`、工具夹具与设计任务评测。
- 文字重叠检测最多比较 400 个文字、报告 2000 对，避免大图退化。
