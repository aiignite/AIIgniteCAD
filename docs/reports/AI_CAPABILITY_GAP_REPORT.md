# AI 能力差距报告（规划 vs 实现）

- 日期：2026-10-22
- 范围：P0–P3 规划项逐条核对代码，加上两轮审计中新发现的差距
- 结论：规划的四期功能**已全部落地**；差距集中在「已落地功能没有真正生效」这一层。
    - **第一轮**（[ADR 0017](../adr/0017-ai-gap-closing-and-conventions-downstream.md)）：10 项差距已修复并通过全量门禁。
    - **第二轮**（[ADR 0018](../adr/0018-ai-tool-contract-and-rejection-loop.md)）：复核前端 AI 闭环与前后端工具契约，
      又确认 11 项差距（G11–G21），其中 2 项阻断；**11 项已全部实施并通过全量门禁**。
    - 另有 4 项为已知限制，不阻塞使用。

## 1. 规划项实现状态

| 期  | 规划项                                                             | 状态   | 主要实现位置                                                                                   |
| --- | ------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------- |
| P0  | 技能 Playbook（步骤 / 检查 / 示例 / 上下文信号 / 反关键词 / 版本） | 已实现 | `backend/src/services/aiEngine/skills/skillService.ts`、`skillRouter.ts`                       |
| P0  | 设计上下文包（三档摘要）                                           | 已实现 | `lib/aiContext.ts`、`backend/src/services/aiEngine/contextManager.ts`                          |
| P0  | 只读设计工具（查询 / 测量 / 检查）                                 | 已实现 | `lib/readOnlyTools.ts`、`lib/elementQuery.ts`、`lib/measurement.ts`                            |
| P0  | 技能编辑器 UI                                                      | 已实现 | `components/AISkillsPanel.tsx`                                                                 |
| P0  | 设计任务级评测集                                                   | 已实现 | `backend/tests/designTaskEval.test.ts`                                                         |
| P1  | 设计操作工具（对齐 / 分布 / 标注链 / 图层分配）                    | 已实现 | `lib/designOps.ts`                                                                             |
| P1  | 计划模式（plan-then-act）                                          | 已实现 | `lib/aiPlan.ts`、`components/chat/ChatPanel.tsx`                                               |
| P1  | 图纸检查面板                                                       | 已实现 | `components/DrawingReviewPanel.tsx`                                                            |
| P2  | 项目设计约定                                                       | 已实现 | `backend/src/routes/projects.ts`、`components/DesignConventionsPanel.tsx`                      |
| P2  | 版本记忆                                                           | 已实现 | `backend/src/lib/versionMemory.ts`、`components/VersionHistoryModal.tsx`                       |
| P2  | 多方案生成                                                         | 已实现 | `lib/aiVariants.ts`                                                                            |
| P2  | 参考图转 CAD                                                       | 已实现 | `lib/imageTrace.ts`、`components/ImageTraceModal.tsx`                                          |
| P3  | 块与符号复用                                                       | 已实现 | `lib/blockCatalog.ts`、`services/blockService.ts`                                              |
| P3  | AI 质量门禁                                                        | 已实现 | `lib/previewReview.ts`、`components/AIPreviewModal.tsx`                                        |
| P3  | 反馈闭环与技能接受率                                               | 已实现 | `backend/src/routes/skills.ts`（`/stats`）、`backend/src/routes/chat.ts`（outcome / feedback） |
| P3  | 技能导入导出                                                       | 已实现 | `lib/skillTransfer.ts`                                                                         |

## 2. 本轮审计发现的差距与修复

严重度：**阻断**＝功能不生效或整轮失败；**高**＝安全 / 正确性风险；**中**＝体验或一致性缺陷。

### G1｜块目录每轮重复拉取（严重度：中）

- 现象：`getBlockCatalog` 每次调用都打一次 `/api/blocks/tree`，一轮对话里计划确认、方案确认、
  主循环各拉一次，整棵块树被反复传输。
- 修复：按项目加 60 秒 TTL 缓存，块 / 分类增删改时主动失效；
  失败或空目录不缓存，避免一次网络抖动让 AI 在一段时间内拿不到任何块。
- 位置：[services/blockService.ts:40](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/services/blockService.ts#L40)

### G2｜技能采纳率没有闭环（严重度：高）

- 现象：`GET /api/skills/stats` 只统计「有用 / 没帮助」这类主观反馈，
  没有「AI 建议被采纳还是被放弃」这一直接信号，技能好坏无法判定。
- 修复：轮次回执（`POST /api/chat/turns/:turnId/outcome`）新增 `skillCodes`，
  与 `outcome`（applied / discarded）一起写进消息 metadata；
  统计接口同时聚合主观反馈与客观采纳，给出 `adoptionRate`。
- 位置：[backend/src/routes/chat.ts:451](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/chat.ts#L451)、
  [backend/src/routes/skills.ts](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/skills.ts)

### G3｜确定性检查读不到项目设计约定（严重度：高）

- 现象：`projects.design_conventions` 已经存了、也已经注入提示词，
  但 `lib/designReview.ts` 完全不读它——用户约定的图层清单与字高既不检查也不提示，
  约定只对模型生效、对确定性规则失效。
- 修复：约定贯通到检查面板、AI 质量门禁与 `check_drawing` 工具三处；
  新增三条规则：图层未登记、约定图层为空、字高不统一。
- 位置：[lib/designReview.ts:288](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/designReview.ts#L288)、
  [lib/aiAgentLoop.ts](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/aiAgentLoop.ts)、
  [lib/readOnlyTools.ts](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/readOnlyTools.ts)、
  [lib/previewReview.ts](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/previewReview.ts)

### G4｜技能 Playbook 的多数字段没有进入提示词（严重度：阻断）

- 现象：`steps` / `checks` / `examples` / `requiredContext` / `negativeKeywords` / `version`
  在数据模型里有、在编辑器里能编辑，但 `describeSkills` 只输出 `promptTemplate`，
  模型实际看不到步骤、检查项与「本技能不适用的场景」。
- 修复：`describeSkills` 按名称成块输出全部字段，技能标题带上版本号。
- 位置：[backend/src/services/aiEngine/promptComposer.ts:155](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/services/aiEngine/promptComposer.ts#L155)

### G5｜只读工具结果绕过字符预算（严重度：高）

- 现象：`query_elements` 之类只读工具的返回体没有走统一的字符预算，
  大图上一次查询就能把上下文撑爆；同时 `check_drawing` 没有把项目约定带进去。
- 修复：统一 `serializeBounded` 截断，超预算时裁剪长字符串字段并保证仍是合法 JSON；
  `check_drawing` 改为读取 `draft.conventions`。
- 位置：[lib/readOnlyTools.ts:73](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/readOnlyTools.ts#L73)

### G6｜后端技能校验弱于前端（严重度：高）

- 现象：前端 `lib/skillTransfer.ts` 会拒绝未知工具名与非法选择类型，
  但 `POST /api/skills` 的后端校验允许 `steps[].tool` 写任意字符串，
  也允许 `selectionTypes` 塞非字符串——绕过前端直接调接口即可写入脏数据。
- 修复：步骤里的工具名必须命中 `TOOL_NAMES`；`selectionTypes` 必须是 ≤32 字的非空字符串。
- 位置：[backend/src/routes/skills.ts:126](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/skills.ts#L126)、
  [backend/src/routes/skills.ts:158](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/skills.ts#L158)

### G7｜全项目 React 类型形同虚设（严重度：高）

- 现象：仓库没有装 `@types/react`，所有 `import React from "react"` 都是 `any`，
  组件的 props 与 state 全无类型约束——`useState<Record<...>>` 少写一个 `>` 也不会报错。
- 修复：补装 `@types/react` / `@types/react-dom`（devDependencies），
  暴露并修复 4 处历史问题：`AISkillsPanel` 泛型解析失败、
  `ErrorBoundary` 用 `declare setState` 绕过类型、`App.tsx` 传了不存在的
  `onLoginClick`（注册页「返回登录」按钮实际失效）、`tests/performance.test.ts`
  漏传 `isSelected`。
- 位置：[package.json](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/package.json)、
  [components/AISkillsPanel.tsx](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/AISkillsPanel.tsx)、
  [App.tsx](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/App.tsx)

### G8｜计划里的编辑步骤被整份拒绝（严重度：阻断）

- 现象：后端校验计划步骤时复用了「编辑类工具必须有作用对象」的规则，
  于是 `{title: "移动选中图元", tool: "move_elements", arguments: {dx: 100, dy: 0}}`
  这种**不带 ids** 的步骤被判为 `NO_TARGET`，**整份计划被丢弃**；
  而前端 `planToToolCalls` + `resolveTargets` 本来就会在用户确认时按当前选择集解析目标。
- 修复：`validateToolCall` 增加 `requireTarget` 选项，计划与多方案步骤校验时关闭该要求；
  直接调用编辑工具时规则不变（仍必须给 ids 或选择集）。
- 位置：[backend/src/services/aiEngine/toolValidator.ts:294](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/services/aiEngine/toolValidator.ts#L294)

### G9｜版本记忆只统计增删、不统计修改（严重度：中）

- 现象：`summarizeVersionChange` 只输出 `added` / `removed`，
  「改了尺寸但没增减图元」这类版本在记忆里表现为「什么都没发生」，
  AI 无法知道用户改了什么。
- 修复：增加 `modified` 与 `modifiedByType`，用轻量几何签名比较新旧版本；
  旧版本摘要缺字段时按 0 处理，存量数据照常可读。
- 位置：[backend/src/lib/versionMemory.ts](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/lib/versionMemory.ts)、
  [components/VersionHistoryModal.tsx](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/VersionHistoryModal.tsx)

### G10｜审查中被推翻的「差距」（无需修改，仅记录）

- 「前后端工具定义不一致」——不成立：`lib/aiTools.ts` 与
  `backend/src/services/aiEngine/tools.ts` 各 28 个 CAD 工具，逐项一致，README 的「28 个」属实。
- 「`resolveTargets` 不校验未知 id」——不成立：显式 ids 命中不全时返回 `null`（整次操作失败）。
- 「反关键词惩罚没有生效」——不成立：`activateSkills` 对 `negativeKeywords` 无条件扣分。
- 「`DesignOpOutcome.changedIds` 是死代码」——不成立：多处测试断言其取值。

## 3. 第二轮差距（G11–G21，已修复）

复核范围扩大到**前端 AI 闭环**与**前后端工具契约**。逐项设计与验收见
[ADR 0018](../adr/0018-ai-tool-contract-and-rejection-loop.md)，此处只列结论。

| 编号 | 差距                                                                                                                            | 严重度 | 证据                                                                                                          | 设计                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| G11  | 计划 / 多方案模式的规则要求步骤工具取自「本轮可用工具」，而该清单只有只读工具 → 计划必然 `failed`                               | 阻断   | `backend/src/routes/llmChat.ts:629`、`backend/src/services/aiEngine/promptComposer.ts:88`、`lib/aiPlan.ts:83` | D1 区分「可调用」与「可引用」工具集         |
| G12  | 被拒调用落库为 tool 消息但不在 assistant 的 toolCalls 里，且顺序在 assistant 之前 → provider 消息序列不合法、拒绝原因回不到模型 | 阻断   | `backend/src/routes/llmChat.ts:845`、`:872`、`backend/src/routes/llmChat.ts:339`                              | D2 调用与结果一一配对 + 顺序修正 + 前端回传 |
| G13  | 前端轮次上限 8 ≠ 后端默认 4，第 5 轮必 400                                                                                      | 高     | `hooks/useAIChat.ts:83`、`backend/src/routes/llmChat.ts:64`、`:513`                                           | D3 轮次上限由服务端下发                     |
| G14  | 写工具参数错误只回一句通用文案，模型无法定位字段                                                                                | 高     | `lib/aiAgentLoop.ts:309`                                                                                      | D4 错误字段化                               |
| G15  | 技能编辑器手写路径的校验弱于导入路径与后端                                                                                      | 高     | `components/AISkillsPanel.tsx:73`、`backend/src/routes/skills.ts:89`                                          | D5 校验单一实现 + 删死代码                  |
| G16  | `blockCount` 恒为 0，块引用上下文信号与技能路由信号永不触发                                                                     | 中     | `components/RightPanel.tsx:160`、`backend/src/routes/llmChat.ts:192`                                          | D6 块插入计入上下文信号                     |
| G17  | brief 档把「有无标注 / 有无块」这类事实一并挡在外面                                                                             | 中     | `lib/aiContext.ts:236`                                                                                        | D7 事实与明细分离                           |
| G18  | 图层截断只写 `…+N more`，不说明隐藏还是锁定                                                                                     | 中     | `lib/aiContext.ts:44`、`:162`                                                                                 | D7 截断补状态计数                           |
| G19  | 失败的工具调用不计入单轮上限                                                                                                    | 中     | `lib/aiAgentLoop.ts:200`                                                                                      | D8 按 accepted + rejected 总数计            |
| G20  | 技能统计不随采纳刷新；`getBlockCatalog` 无异常兜底                                                                              | 低     | `components/AISkillsPanel.tsx:169`、`components/chat/ChatPanel.tsx:120`                                       | D8 事件驱动刷新 + 降级空目录                |
| G21  | 方案差异只靠模型自述；循环无重复调用检测                                                                                        | 低     | `components/chat/VariantCards.tsx:122`                                                                        | D8 几何差分 + 重复提示                      |

### 实施落点

| 编号 | 落地位置 | 验收断言 |
| ---- | -------- | -------- |
| G11  | `backend/src/services/aiEngine/promptComposer.ts`（可引用写工具清单）、`lib/aiPlan.ts`、`lib/aiVariants.ts` | `tests/aiPlan.test.ts`、`backend/tests/*` 提示词含写工具清单 |
| G12  | `backend/src/routes/llmChat.ts`（tool_call / tool 配对与顺序）、`hooks/useAIChat.ts`（拒绝回传） | `backend/tests/llmChatAgent.test.ts` 消息序列合法 |
| G13  | `backend/src/routes/llmChat.ts` 下发 `maxToolRounds`、`lib/aiSseEvents.ts` 的 `effectiveMaxRounds` | `tests/aiSseEvents.test.ts` |
| G14  | `lib/aiTools.ts` 的 `ToolCallResult` + 字段级读取器、`lib/aiAgentLoop.ts` 透传原因 | `tests/aiTools.test.ts` 错误含字段名与工具名 |
| G15  | `lib/skillValidation.ts`（编辑器与导入共用）、`lib/skillTransfer.ts` | `tests/skillValidation.test.ts` |
| G16  | `lib/aiAgentLoop.ts` 的 `blockInsertions`、`hooks/useAIChat.ts` 计数进上下文 | `tests/aiAgentLoop.test.ts` |
| G17  | `lib/aiContext.ts` brief 档 Facts 行 | `tests/aiContext.test.ts` |
| G18  | `lib/aiContext.ts` 的 `orderedLayers` / `layerState` 截断计数 | `tests/aiContext.test.ts` |
| G19  | `lib/aiAgentLoop.ts` 的 `MAX_TOOL_CALLS_PER_ROUND` 按尝试数计 | `tests/aiAgentLoop.test.ts` 失败调用占额度 |
| G20  | `store/skillStats.ts` + `services/apiService.ts` 回执后标脏；`services/blockService.ts` 返回 `BlockCatalogResult`，`lib/readOnlyTools.ts` / `lib/aiTools.ts` 区分「不可用」与「空库」 | `tests/skillStats.test.ts`、`tests/designTools.test.ts`、`tests/aiTools.test.ts` |
| G21  | `lib/aiAgentLoop.ts` 的 `diffElementCounts` 与重复调用提示、`components/chat/VariantCards.tsx` 卡片刻度 | `tests/aiAgentLoop.test.ts`、`tests/e2e/aiChat.spec.ts` |

三条根因（第二轮全部差距的来源）：

1. **同一份契约在前后端各写一份并且已经开始漂移**（轮次上限 8 vs 4）。
2. **提示词引用了错误的清单**——把「可调用工具」当成了「可引用工具」。
3. **被拒的调用没有回到模型上下文**，落库顺序也不满足 provider 对 tool / tool_call 配对的要求。

## 4. 核对后确认不是差距的规划项

- 工具数量：前后端各 28 个 CAD 工具 + 2 个模式控制工具（`propose_plan` / `propose_variants`），
  控制工具不属于 CAD 工具集，前端 `lib/aiTools.ts` 与后端定义一致。
- 单一写入路径：AI 的所有写操作都走 `computeAIActionOutcome` → `AIPreviewModal` → 一次 `commitAction`，
  计划模式、多方案模式、块插入都不例外。
- 上下文体量：发送上下文统一走 `summarizeCanvasContext`，不把完整图元 JSON 塞进提示词。

## 5. 仍然存在的已知限制

以下不是缺陷，是当前设计取舍，记录下来避免后续误判：

1. **块目录缓存 60 秒**：块库在别处改动后，AI 最多 60 秒内看不到；本机增删改块会立即失效。
2. **统计窗口有上限**：`/api/skills/stats` 默认扫最近 30 天（最多 365 天、单次最多 5000 条消息），
   超过窗口的历史不参与有用率 / 采纳率。
3. **版本记忆只回摘要**：版本列表只回 `elementCount` 等元数据，
   快照正文按需加载；AI 拿到的是摘要文本而非完整图元。
4. **`propose_plan` / `propose_variants` 是模式控制工具**：不计入 28 个 CAD 工具，
   在计划 / 多方案模式下单独下发，不能在普通模式下被模型直接调用。
5. **G11 修复后计划步骤仍受后端白名单约束**：步骤里出现的工具名必须是 28 个 CAD 工具之一，
   `propose_plan` / `propose_variants` 本身不能被引用。

## 6. 已完成改动的验证

- 前端：`npm run lint`、`npm run typecheck`、`npm test`（47 个测试文件 / 546 个用例）、`npm run build`
- 后端：`npm run lint`、`npx tsc --noEmit`、`npm test`（29 个测试文件 / 329 个用例）
- E2E：`npm run test:e2e`（33 条）
- 依赖：`npm audit --omit=dev --audit-level=high`（前后端各一次，0 漏洞）
