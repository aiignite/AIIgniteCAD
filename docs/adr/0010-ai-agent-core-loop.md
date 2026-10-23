# ADR 0010：AI Agent 核心闭环（模型解析 / 助手 / 技能 / 前端工具循环）

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：AI 与 CAD 团队

## 背景

对齐 AIIgnitePLM 的 AI 层后发现本仓库存在四处"配置存在但不生效"：模型记录只有单条可用、助手的系统提示词不参与装配、技能/关键词没有任何路由入口、会话历史只落在浏览器本地。同时工具调用缺少可信的执行位置：服务端没有画布，直接写画布又绕过预览确认。

## 决策

1. **模型解析与故障转移**：`backend/src/services/aiEngine/modelResolver.ts` 按「请求显式 modelId → 助手绑定 → 默认模型 → 任一启用模型」解析候选链；Provider 差异收敛到 `providers/`（OpenAI 兼容 / Anthropic / Google / Ollama），只对可重试类错误（网络、超时、429、5xx）沿候选链切换并下发 `model_fallback` 事件，鉴权与参数类错误立即终止，避免无意义重试烧钱。
2. **助手真正生效**：`promptComposer.ts` 用助手的 `systemPrompt` 替换默认角色提示词，并注入助手的工具白名单、`maxToolRounds`、temperature/maxTokens 与绑定技能；前端 `useAIChat` 携带 `assistantId`，会话通过 `PATCH /chat/sessions/:id` 记住助手与模型覆盖。
3. **技能系统**：技能 = 数据库 `AiSkill` + `builtinSkills.ts` 内置种子。`skillRouter.ts` 用规则打分（关键词命中、选中图元类型、priority、用户手动 pin）取 top-K，命中结果以 `skill_activated` 事件下发并在聊天时间线显示评分与理由；手动 pin 的技能绕过打分直接生效。技能只能通过白名单收窄工具集，不能扩展助手允许的工具。
4. **会话服务端持久化 + 确定性摘要**：`ChatSession` / `ChatMessage` 落库，消息以 `(sessionId, clientMessageId)` 幂等 upsert；`clientMessageId` 形如 `turnId`、`turnId:r{n}:assistant`、`turnId:r{n}:tool:{toolCallId}`，工具结果行归到**提议它的那一轮**（`r{n-1}`），否则历史回放会把已执行的工具显示成"待执行"。`contextManager.ts` 负责历史窗口与摘要压缩，前端通过 `POST /chat/sessions/:id/compact` 触发。
5. **前端虚拟画布工具循环**：一次 HTTP 回合只做一次模型调用；工具在浏览器草稿数组上求值（`lib/aiAgentLoop.ts` 的 `createDraft` / `applyToolCalls`），非法参数单条拒绝并把原因回传给模型自我修正，结果以 `phase="tool_results"` 续轮回传。草稿不触碰真实画布，循环结束后整批动作一次性进入 `AIPreviewModal`，确认后单次 `commitAction`，因此多轮仍只占一步撤销。
6. **回合台账**：`useAIChat` 用模块级 `const roundIndex = round` 快照轮次，禁止 `setMessages` updater 读取可变的 `round`（React 在渲染时才执行 updater，会写到下一轮）。预览确认后 `POST /chat/turns/:turnId/outcome` 记录 applied/discarded，用量与成本进入 `usageAccounting.ts` 台账并在聊天底部展示。

## 理由

- 服务端没有画布状态，把执行放在前端才能让工具结果基于真实图元求值，同时天然满足"必须预览确认"的既有约束（ADR 0005）。
- 逐轮回传让模型能基于失败原因修正，比一次性生成整批动作可靠；代价是延迟随轮次线性增长，因此用 `maxToolRounds` 与单轮上限双重封顶。
- 规则打分 + 手动 pin 的技能路由不需要嵌入向量与额外模型调用，行为可解释、可测试。
- 确定性 `clientMessageId` 使断线与重放不产生重复历史或重复计费。

## 后果

- 工具在浏览器求值意味着服务端无法独立审计最终画布结果；审计依赖 outcome 台账与用量记录。
- 多轮循环提高了延迟与 token 成本，且模型必须在最后一轮不再提议工具才能收敛，否则达到上限后提示用户继续追问。
- 技能与助手配置改变会直接影响输出质量，新增内置技能必须附关键词与选中类型测试。
- 会话历史依赖服务端，未打开图纸（无 projectId）时对话只留在本地视图，不写入历史。

## 相关

- `backend/src/services/aiEngine/{modelResolver,promptComposer,contextManager,usageAccounting,toolValidator,tools}.ts`、`backend/src/services/aiEngine/skills/`、`backend/src/routes/{llmChat,chat,skills,assistants,llm}.ts`
- `hooks/useAIChat.ts`、`hooks/useAIRegistry.ts`、`lib/{aiAgentLoop,aiChatHistory,aiSseEvents,aiTools,aiUi}.ts`、`components/chat/`
- `docs/architecture/AI_FLOW_ANALYSIS.md`、ADR 0004、ADR 0005、ADR 0006
