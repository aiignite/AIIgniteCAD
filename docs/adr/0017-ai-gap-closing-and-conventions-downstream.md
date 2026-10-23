# ADR 0017：AI 能力差距核对与收敛（约定下沉、Playbook 全量注入、计划目标延迟解析）

- 状态：已采纳
- 日期：2026-10-22
- 相关：ADR 0004（AI 工具调用）、ADR 0005（预览与单步撤销）、ADR 0010（Agent 循环）、ADR 0013（技能与设计上下文）、ADR 0014（计划模式与检查面板）、ADR 0015（设计约定与多方案）、ADR 0016（块复用与反馈闭环）

## 背景

P0–P3 四期规划项已全部落地，但一轮以「规划 vs 实现」为口径的逐条核对发现：
**差距不在功能是否存在，而在已落地的功能有没有真正生效**。本 ADR 记录这轮收敛中
需要跨前后端统一、且会影响后续设计的四个决策；完整差距清单见
[差距报告](../reports/AI_CAPABILITY_GAP_REPORT.md)。

## 决策

### 1. 项目设计约定是规则来源，必须下沉到确定性检查

`projects.design_conventions` 原本只以提示词形式影响模型，模型遵守与否不可控。
现在约定同时驱动 `lib/designReview.ts` 的三条新规则（图层未登记、约定图层为空、
字高不统一），并贯通到三个消费方：

- 图纸检查面板（`components/DrawingReviewPanel.tsx`）
- AI 质量门禁（`lib/previewReview.ts` → `components/AIPreviewModal.tsx`）
- `check_drawing` 只读工具（`lib/readOnlyTools.ts`）

约定随草稿一起流动（`AgentDraft.conventions`），Agent 循环更新草稿时必须保留它，
否则多轮工具调用后约定会丢失。

**取舍**：约定图层检查会给出 warning 而不是 error——约定本身是可编辑的用户输入，
不应把用户的临时约定变成硬阻断。

### 2. 技能 Playbook 字段必须全量进入提示词

数据模型里有、编辑器里能编辑，但模型看不到的字段等于不存在。
`describeSkills` 现在按「技能名 + 版本号」成块输出 `promptTemplate`、`steps`、`checks`、
`examples`、`requiredContext` 与 `negativeKeywords`，其中反关键词渲染为
「不适用场景」，让模型在拿到需求时就能判断该不该用这条技能。

### 3. 计划与多方案步骤的目标在执行时解析，不在校验时要求

后端校验计划步骤时复用「编辑类工具必须有作用对象」的规则，导致
`{tool: "move_elements", arguments: {dx: 100}}` 这种不带 ids 的步骤被判 `NO_TARGET`，
**整份计划被丢弃**；而前端 `planToToolCalls` + `resolveTargets` 本来就会在用户确认时
按当前选择集解析目标。

因此 `validateToolCall` 增加 `requireTarget` 选项：计划 / 多方案步骤校验时关闭该要求，
直接调用编辑工具时规则不变。**作用域在执行时收紧、校验时只收紧参数本身**，
这是本轮最关键的一条——它把「校验」与「解析」两件事分开了。

### 4. 技能好坏用两个信号判断：主观反馈 + 客观采纳

轮次回执（applied / discarded）是用户对 AI 建议的直接裁决，比「有用 / 没帮助」更接近
技能真实效果。因此：

- `POST /api/chat/turns/:turnId/outcome` 接受 `skillCodes`，与 `outcome` 一起写入消息 metadata；
- `GET /api/skills/stats` 同时聚合主观反馈（`feedback`）与客观采纳（`outcome`），
  分别给出 `helpfulRate` 与 `adoptionRate`，并把分母口径写清楚（未评价不计分母、
  未决策不计入采纳率）。

不新增表、不新增迁移：两个信号都落在 `ChatMessage.metadata` 上。

## 后果

- 约定驱动的检查让图纸检查面板从「通用体检」变成「按项目标准体检」，
  但也意味着约定一旦写错，检查面板会持续提示；约定面板因此必须好编辑。
- 计划步骤不再因为缺 ids 被拒，但模型也可能写出「移动选中图元」这类在用户确认时
  没有选择集的空步骤；此时前端 `resolveTargets` 返回空目标，步骤被跳过而不是全图误操作。
- 采纳率统计依赖用户真的点「应用 / 放弃」；没有回执的轮次不计入分母，
  新技能在积累回执之前不会出现在统计里。
- 统计窗口有上限（默认 30 天、最多 365 天、单次最多 5000 条消息），超窗历史不参与计算。

## 验证

- 前端 `tests/designTools.test.ts`（约定三类规则）、`tests/previewReview.test.ts`（门禁读约定）
- 后端 `backend/tests/aiPromptComposer.test.ts`（Playbook 全量注入）、
  `backend/tests/skills.test.ts`（采纳率与后端校验）、
  `backend/tests/toolValidation.test.ts`（计划步骤不要求 ids）、
  `backend/tests/versionMemory.test.ts`（修改数统计）、
  `backend/tests/blocks.test.ts`（块目录展开图元）
