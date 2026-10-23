# ADR 0018：AI 工具契约、拒绝回环与上下文信号的收敛设计

- 状态：已采纳（G11–G21 已全部实施并通过门禁）
- 日期：2026-10-22
- 相关：ADR 0004（AI 工具调用）、ADR 0005（预览与单步撤销）、ADR 0010（Agent 循环）、ADR 0014（计划模式与检查面板）、ADR 0016（块复用与反馈闭环）、ADR 0017（差距收敛第一轮）

## 背景

第一轮补差（[ADR 0017](0017-ai-gap-closing-and-conventions-downstream.md)）修的是「已落地功能没生效」。
第二轮复核把范围扩到**前端 AI 闭环**与**前后端工具契约**，又确认了 11 项残留差距：

| 编号 | 差距                                                                          | 严重度 |
| ---- | ----------------------------------------------------------------------------- | ------ |
| G11  | 计划 / 多方案模式：规则要求步骤工具取自「本轮可用工具」，而该清单只有只读工具 | 阻断   |
| G12  | 被拒工具调用落库后产生无对应 tool_call 的 tool 消息，且顺序在 assistant 之前  | 阻断   |
| G13  | 前端工具轮次上限 8 ≠ 后端默认 4，第 5 轮必 400                                | 高     |
| G14  | 写工具参数错误只回一句通用文案，模型无法定位字段                              | 高     |
| G15  | 技能编辑器（手写路径）校验弱于导入路径与后端                                  | 高     |
| G16  | `blockCount` 恒为 0，块引用上下文信号与技能路由信号永不触发                   | 中     |
| G17  | brief 档把「有无标注 / 有无块」这类事实一并挡在外面                           | 中     |
| G18  | 图层截断只写 `…+N more`，不说明多出来的是隐藏还是锁定                         | 中     |
| G19  | 失败的工具调用不计入单轮上限，可塞远超 20 次失败调用                          | 中     |
| G20  | 技能统计不随采纳刷新；`getBlockCatalog` 无异常兜底                            | 低     |
| G21  | 方案差异只靠模型自述；循环无重复调用检测                                      | 低     |

这 11 项的根因收敛为三条，都不是「缺功能」：

1. **同一份契约在前后端各写了一份，并且已经开始漂移**（轮次上限 8 vs 4）。
2. **提示词引用了错误的清单**——计划模式把「可调用工具」当成「可引用工具」写进了规则。
3. **被拒的调用没有回到模型上下文**，落库顺序也不满足 provider 对 tool / tool_call 配对的要求。

因此本 ADR 不按「补一个功能」组织，而是按**四条设计原则**重新收敛契约。

## 设计原则

| 原则              | 含义                                                                                             | 反面教材                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| P1 单一事实源     | 跨包契约（可引用工具集、轮次上限、字段校验规则）由服务端下发或由同一份规则表表达，前端不维护副本 | 前端 `MAX_ROUNDS = 8` vs 后端 `DEFAULT_MAX_TOOL_ROUNDS = 4`    |
| P2 拒绝必须闭环   | 工具被拒是模型的一次错误输入，原因必须回到模型上下文；且不得产生 provider 不接受的消息序列       | 拒绝只进 `state.rejections`，不进 `toolResults`                |
| P3 校验与执行分离 | 参数在服务端收紧；作用域（作用对象）在执行时按实时选择集解析                                     | 计划步骤因缺 `ids` 被整份拒绝（ADR 0017 已修一半）             |
| P4 提示词内部自洽 | 规则里引用的任何清单必须在同一份提示词里给出，措辞指向正确的清单                                 | 「tool 只能使用本轮可用工具中的 CAD 工具」← 该清单只有只读工具 |

## 决策

### D1｜区分「可调用工具集」与「可引用工具集」（修复 G11）

**现象**：[`backend/src/routes/llmChat.ts:629`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/llmChat.ts#L629) 在计划模式下把 `allowedTools` 设为只读工具 + `propose_plan`；
[`promptComposer.ts:88`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/services/aiEngine/promptComposer.ts#L88) 的计划规则要求「tool 只能使用**本轮可用工具**中的 CAD 工具」，
而「本轮可用工具」段落列出的正是那 5 个只读工具。
守规则的模型只能写出只读步骤 → [`lib/aiPlan.ts:83`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/aiPlan.ts#L83) 把只读步骤全部过滤 →
计划卡片「执行计划」永远 `disabled`，计划被判 `failed`。多方案模式同理。

**根因**：计划步骤里的 `tool` 是**引用**（用户确认后才真正执行），不是**调用**（本轮就该发起）。
把两者混为一谈，规则自然自相矛盾。

**设计**：

1. 引入第二个集合 `referenceableTools`，语义是「步骤里可以引用并在确认后执行的工具」。
    - 直接模式：`referenceableTools` 不适用。
    - 计划 / 多方案模式：`referenceableTools` = 全部 28 个 CAD 工具（22 写 + 5 只读 + 1 视图）。
    - `allowedTools`（本轮可**调用**）保持不变：只读 + `propose_plan` / `propose_variants`。
2. 提示词新增段落「**# 计划步骤可引用的写工具**」，列出写工具名 + 关键参数 + 一句话语义，
   并说明「省略 `ids` 表示作用于用户确认时的当前选择集」。
   内容**由 `CAD_TOOL_DEFINITIONS` 自动生成**（工具名 / description / required / properties），
   不手写第二份清单——这是 P1 的直接落地。
3. 规则文案改为：「steps 中需要落图的步骤必须填写 tool 与 arguments，tool 取自
   **「计划步骤可引用的写工具」**；只读工具用于确认现状，不写进步骤。」
4. 服务端保留现有白名单：`toolValidator` 的 `CAD_TOOL_NAMES` 已保证步骤工具必须是真实 CAD 工具名。
   额外约束：步骤工具不得是 `propose_plan` / `propose_variants` 本身（现有白名单已天然排除）。
5. 前端 `planToToolCalls` 行为不变（只读 / 视图步骤不落图，这是对的）。

**改动点**：`backend/src/services/aiEngine/promptComposer.ts`（新增段落生成器 + 改写规则）、
`backend/src/routes/llmChat.ts`（计算并下发 `referenceableTools`）、
`backend/src/services/aiEngine/tools.ts`（从工具定义生成速查表）。

**验收**：单测断言计划模式提示词包含 `draw_line` 等写工具名与参数说明，且不再出现
「本轮可用工具中的 CAD 工具」这一措辞；E2E 断言计划卡片的「执行计划」可点击并能落图。

### D2｜工具调用与结果一一配对，拒绝也要回到模型（修复 G12）

**现象**：[`llmChat.ts:845`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/llmChat.ts#L845) 把被拒调用落库为
`role: "tool"` + `toolCallId`，但同一请求里落库的 assistant 消息
（[`llmChat.ts:872`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/llmChat.ts#L872)）的 `toolCalls` 只含**被接受**的调用。
后果有两个：

- **序列不合法**：落库顺序是「tool(被拒) → assistant → tool(被接受)」，
  provider 看到的第一条就是 tool 消息，其前没有带 tool_calls 的 assistant 消息。
  OpenAI 兼容接口对此直接 400。
- **自纠错断链**：被拒原因虽然写进了 tool 消息正文，但那条消息排在 assistant 之前，
  且 provider 侧工具调用与结果无法配对，模型读不到失败原因。

**设计**（P2 的完整落地）：

1. **assistant 消息收录全部模型发起的调用**：`toolCalls` = accepted + rejected。
   被拒调用的 arguments 存模型原始输出（有界，单条 ≤ 1000 字符，缺省 `{}`），
   保证「每个 tool_call 都有对应的 tool 消息」。
2. **被拒的 tool 消息改到 assistant 消息之后落库**：把拒绝分支的 `persistMessage`
   从校验循环里挪到 assistant 落库之后，序列变成 `assistant → tool(rejected) → tool(accepted)`。
3. **前端把 `state.rejections` 并入下一轮的 `toolResults`**：
   拒绝项以 `{ok: false, error: 原因}` 形式回传，后端沿用既有 tool 消息落库路径
   （`clientMessageId` 幂等 upsert，不会重复）。
4. **`toProviderMessages` 防御性过滤**：tool 消息的 `toolCallId` 若在前一条 assistant 的
   `toolCalls` 里找不到，则跳过该条（或降级为 user 文本），
   保护历史脏数据不至于直接打爆 provider。
5. 拒绝原因保持服务端 `toolValidator` 的精确文案（如 `draw_line.x1 超出允许范围`），
   这与 D4 是一条链：服务端已能精确定位，前端也要能。

**改动点**：`backend/src/routes/llmChat.ts`（落库顺序、`toolCalls` 内容）、
`backend/src/services/aiEngine/contextManager.ts`（`toProviderMessages` 防御）、
`hooks/useAIChat.ts` + `lib/aiSseEvents.ts`（rejections 并入 toolResults）。

**验收**：单测断言——一次含被拒调用的会话，下一轮 provider 请求的 messages 满足
「每个 tool 消息的 tool_call_id 都能在前一条 assistant 的 tool_calls 中找到」，
且被拒原因出现在 tool 消息正文里。

### D3｜工具轮次上限由服务端下发（修复 G13）

**现象**：[`hooks/useAIChat.ts:83`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/hooks/useAIChat.ts#L83) 写死 `MAX_ROUNDS = 8`，
后端 [`llmChat.ts:64`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/llmChat.ts#L64) 默认 `DEFAULT_MAX_TOOL_ROUNDS = 4`，
且不选助手时（`RightPanel` 默认 `assistant = null`）前端取 8。
后端在 `phase === "tool_results" && round >= maxRounds` 时直接 400，
于是**任何需要 5 轮以上工具的请求都会在第 5 轮报错**（草稿动作不丢，但用户看到红色失败）。

**设计**（P1 的直接落地）：

1. 后端在已有的 `context` SSE 事件里下发 `maxRounds`（取 `assistant?.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS`）。
   该事件已在第 8 步发送，正好赶在第二轮请求之前。
2. 前端 `ContextEvent` 增加 `maxRounds?: number`；循环中以
   `min(本地硬上限 8, 服务端 maxRounds)` 作为有效轮次上限，随 context 事件更新。
3. 拿不到 context 事件时（对接旧后端）回落到 **4**，与后端默认值一致，宁可少跑一轮也不打 400。
4. 本地硬上限保留为 8，作用是防止服务端配置异常时前端无限循环。

**验收**：单测——context 事件带 `maxRounds`；服务端声明 2 轮时前端不发第 3 轮；
无 context 事件时前端轮次上限为 4。

### D4｜写工具错误定位到字段（修复 G14）

**现象**：[`lib/aiAgentLoop.ts:309`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/aiAgentLoop.ts#L309) 对所有写工具失败返回同一句
「参数不合法，或没有可作用的图元」。模型拿不到「是哪个参数错」，只能盲猜重试。
后端 `toolValidator` 其实已经能精确到 `draw_line.x1 超出允许范围`。

**设计**：

1. `lib/aiTools.ts` 的转换结果同时携带动作与失败原因（`ToolCallResult { action?, error? }`），
   失败时带上字段名（如 `draw_line.x1 缺失或不是数字`、`array_elements.rows 不能小于 1`）。
   实现用**可选字段结构**而不是原计划的判别联合：本仓库前端 tsconfig 未开 `strict`，
   按 `ok` 字面量收窄在 `tsc --noEmit` 下会失效，调用方拿不到类型。
2. `lib/aiAgentLoop.ts` 直接透传工具返回的具体原因，不再拼通用文案。
3. **覆盖全部 22 个写工具**（不再只挑高频子集）：字段名与取值范围逐条对齐后端 `NUMBER_RULES`
   与文本/点列/枚举规则，两端不另立标准；同时删除只被自身测试引用的 `toolCallsToActions`
   （Agent 循环按调用逐条产生动作，合并撤销由预览提交负责）。

**验收**：单测——`draw_line` 缺 `x1` 时错误信息含 `x1`；`array_elements.rows = 0` 时含 `rows`；
每条非法参数夹具的错误信息都含工具名。

### D5｜技能字段校验单一实现（修复 G15）

**现象**：三条写入路径对同一批约束的执行力度不一致：

| 路径                                            | 长度上限 | 工具名白名单 | 数组条数 | priority 范围 |
| ----------------------------------------------- | -------- | ------------ | -------- | ------------- |
| 导入（`lib/skillTransfer.ts`）                  | ✅ 完整  | ✅           | ✅       | ✅            |
| 编辑器手写（`components/AISkillsPanel.tsx:73`） | ❌       | ❌           | 部分     | ❌            |
| 后端（`backend/src/routes/skills.ts`）          | ✅       | ✅           | ✅       | ✅            |

结果：手写路径打错一个工具名 → 整份技能 400，用户看不出是哪一步的问题。

**设计**：

1. 把 `lib/skillTransfer.ts` 中的字段级校验抽成 `lib/skillValidation.ts` 的纯函数
   （`validateSkillSteps` / `validateSkillKeywords` / `validateSkillPrompt` …），
   返回 `{ field, error }` 而非裸字符串，便于定位到具体输入框。
2. 导入路径与编辑器路径共用同一套函数；编辑器在保存前先跑一次，把错误定位到对应字段，
   不再靠后端 400 反馈。
3. 后端保留 express-validator 作为**权威防线**（客户端校验不是唯一防线），
   但错误文案与前端保持逐字一致——两端各写一份规则表，靠「同一组错误文案 + 同一组用例」对齐。
4. 附带清理：[`backend/src/services/aiEngine/tools.ts:701`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/services/aiEngine/tools.ts#L701)
   的 `generateToolSystemPrompt` 是**死代码**（只被自己的测试引用），
   且内容与现行设计冲突（写着「screen coordinates / 800x600」，而当前是画布世界坐标）。
   直接删除，连同其测试。

**验收**：单测——步骤引用未知工具时，编辑器校验返回 `field: "steps"` 的错误；
导入路径的既有测试全部保持通过。

### D6｜块插入计入上下文信号（修复 G16）

**现象**：`canvasContext.blockCount` 的唯一来源是
[`components/RightPanel.tsx:160`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/components/RightPanel.tsx#L160) 的
`activeProject?.blockReferences?.length`，而**全仓无人写入** `blockReferences`
（`insert_block` 走的是「展开为图元」，不产生块引用记录）。
结果 `blockCount` 恒为 0 → 提示词里的「块引用：N 个」永不出现，
[`llmChat.ts:192`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/backend/src/routes/llmChat.ts#L192) 的 `blocks` 上下文信号永不触发，
依赖块库的技能永远不会被激活。

**设计**：

1. `AgentDraft` 增加 `blockInsertions: { blockId: string; name: string }[]`，
   `insert_block` 成功时追加一条。
2. 每轮请求的 `canvasContext.blockCount` = 持久化的块引用数 + 草稿内已插入的块数。
   这样「本轮刚插入的块」在下一轮就进入上下文，模型不会重复插同一个块。
3. 不引入 `BlockReference` 落库路径：ADR 0016 已明确「块插入走展开为图元」，
   上下文信号只需反映**事实**，不需要第二套持久化。

**验收**：单测——`insert_block` 后草稿的 `blockInsertions` 长度为 1，
且下一轮请求的 `canvasContext.blockCount` ≥ 1。

### D7｜上下文分档：事实与明细分离（修复 G17、G18）

**现象**：

- [`lib/aiContext.ts:236`](file:///Users/wyh/Documents/AIIgnite/AIIgniteCAD/lib/aiContext.ts#L236) 用 `tier !== "brief"` 把
  块 / 标注 / 隐藏对象 / 修订号一起挡在 brief 档外。
  而 brief 档恰好命中「再加个标注」这类短指令——
  模型既不知道图上有没有标注，也不知道有没有块。
- 图层列表超过 8 层时只写 `…+N more`，模型不知道多出来的层是隐藏还是锁定。

**设计**：

1. **布尔型事实提到 brief 档**：用一行给出「有标注：是/否 · 有块引用：N · 隐藏图层：K · 锁定图层：M」，
   明细列表仍留在 standard / deep 档。
2. **图层截断补状态计数**：`…+N more` 改为 `…另有 N 个图层（含 K 个隐藏、M 个锁定）`。

**验收**：单测——brief 档上下文包含「有标注：是」；standard 档图层截断时包含隐藏 / 锁定计数。

### D8｜杂项（修复 G19–G21）

| 差距                         | 设计                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| G19 失败调用不计入单轮上限   | 单轮工具调用上限按「accepted + rejected」总数计，与后端 `MAX_TOOL_CALLS_PER_TURN` 对齐 |
| G20 统计不随采纳刷新         | 回合回执成功后触发一次 `/api/skills/stats` 刷新（前端事件驱动，不轮询）                |
| G20 `getBlockCatalog` 无兜底 | 失败降级为空目录并让 AI 明确知道「块库不可用」，不产生未处理 rejection                 |
| G21 方案差异只靠自述         | 用已有的元素差分算几何差异，在方案卡片上显示「新增 N / 修改 M / 移除 K」               |
| G21 循环无重复调用检测       | 同一 `tool + arguments` 连续重复时，在 toolResult 里提示模型换个做法，不直接拒绝       |

**实施说明**：

1. G19 按调用在数组中的下标判断上限，因此失败、只读、视图调用都占额度；
   原来只为算额度而维护的 `AgentDraft.executed` 字段随之删除。
2. G20 的刷新信号沿用本仓库既有的轻量外部 store 形态（`store/skillStats.ts` 只有一个版本号 +
   `Set<listener>`），`services/apiService.ts` 在 outcome / feedback 两个回执成功后各标脏一次，
   技能面板用 `useSyncExternalStore` 订阅，不引入轮询。
3. G20 的块目录兜底把失败信号透出为 `BlockCatalogResult { entries, ok }`：
   `createDraft` 的块目录参数可接收集合或该结果，草稿据此记 `blocksUnavailable`，
   `list_blocks` 与 `insert_block` 在不可用时明确回报「块库当前不可用……不是空库」。
4. G21 的几何差分复用 Agent 循环内部的图元分类（引用变化即视为修改），
   对外只暴露 `diffElementCounts`；三项全为 0 时卡片显示「无几何变化」，
   避免用户把只有说明性步骤的方案当成有效改动。

## 实施顺序

按「阻断优先 + 每步可独立验收」排列，每一步都是一次可回滚的提交：

| 步骤 | 内容                                             | 对应差距 | 依赖                  |
| ---- | ------------------------------------------------ | -------- | --------------------- |
| 1    | 计划 / 多方案提示词补可引用写工具清单            | G11      | —                     |
| 2    | 拒绝回环：配对 + 顺序 + 前端回传 + provider 防御 | G12      | —                     |
| 3    | 轮次上限服务端下发                               | G13      | 2（context 事件扩展） |
| 4    | 块插入计入上下文信号                             | G16      | —                     |
| 5    | 技能校验抽取共用 + 删除死代码                    | G15      | —                     |
| 6    | 写工具错误字段化                                 | G14      | —                     |
| 7    | 上下文分档调整                                   | G17、G18 | —                     |
| 8    | 杂项                                             | G19–G21  | —                     |

步骤 1、2、3 完成后，计划 / 多方案 / 多轮对话三条主链路才算真正可用；
其余为质量与一致性收尾。

步骤 1–8 已于 2026-10-22 全部落地，第 9 步（专项断言 + 全量门禁 + 文档同步）的验证结果记在
[差距报告 §6](../reports/AI_CAPABILITY_GAP_REPORT.md)。

## 验收

统一沿用 AGENTS.md 的提交前门禁（前端 lint / typecheck / test / build，后端 lint / tsc / test，
`npm run test:e2e`，生产依赖 audit），并追加本轮专项断言：

- **后端**：`backend/tests/llmChatAgent.test.ts` 补「被拒调用后下一轮 provider 消息序列合法」
  与「计划模式提示词包含写工具清单」两条；`backend/tests/toolCalls.test.ts` 删掉死代码用例。
- **前端**：`tests/aiPlan.test.ts` 补「计划步骤可引用写工具」；
  `tests/aiContext.test.ts` 补 brief 档事实行与图层截断计数；
  `tests/designTools.test.ts` 补写工具字段级错误。
- **E2E**：`tests/e2e/aiChat.spec.ts` 补「计划卡片可执行并落图」。

## 不做的事

- **不引入块引用落库**：`BlockReference` 与「展开为图元」是两套语义，
  本轮只让上下文反映事实，不做持久化改造（D6）。
- **不把只读工具开放给计划步骤执行**：只读步骤在计划阶段已经跑过，
  写进计划再执行一次是重复劳动。
- **不引入共享 npm 包**：前后端共用规则靠「同一份规则表 + 同一组用例」对齐，
  为两个包引入跨包构建依赖不划算。
- **不追求提示词里列全部工具的参数**：只列写工具的关键参数与作用域语义，
  完整 schema 仍由 provider 的 tool 定义承载。
