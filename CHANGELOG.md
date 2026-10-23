# Changelog

本项目的重要变更记录在此文件。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Fixed

- 子路径部署下图标不再退化成英文单词：`@font-face` 的 `src` 原写绝对路径 `/fonts/...`，挂在 `/cad/` 下会去请求站点根、被网关默认站点以 `text/html` 兜底返回，Material Symbols 连字全部显示成 `send`、`folder_open`；改为相对自身解析，并把 `public/` 里无内容哈希的 CSS 与 `index.html` 从 30 天/启发式缓存改成 `no-cache`（字体二进制仍长缓存），否则修好了老访客也看不见。
- 生产站点挂在 `/cad/` 子路径后不再整站失联：前端构建改为读取 `VITE_BASE_PATH` / `VITE_API_URL`，实时协作的 socket.io 握手路径按 API 基址推导前缀（`collaborationSocketPath`），否则升级请求会落到网关默认站点、协作面板只显示连接失败。
- 后端识别两级代理的 `X-Forwarded-For`（`trust proxy`）：限流按 `req.ip` 计数，不认代理头会让全部访客挤进同一个桶，认证配额几分钟内被打满。
- 后端镜像带上 Prisma 迁移（`.dockerignore` 此前排除了 `prisma/migrations`），容器内 `prisma migrate deploy` 才有可执行的迁移，否则生产库只能停留在空 schema。

- 计划与多方案不再必然失败：提示词此前把「本轮可调用工具」（只读工具）当成「步骤可引用工具」，模型只能引用 `query_elements` 这类不写图的步骤；现在单独下发 22 个写工具的速查表，规则只约束步骤引用（[ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md)）。
- 被拒绝的工具调用会成对回传给模型，并点名失败字段与取值范围：此前拒绝只留在前端本地，模型看不到原因、落库顺序也不满足 provider 对 `tool_calls` / `tool` 配对的要求。
- 前端工具轮次上限改为读取服务端下发的 `maxToolRounds`（默认 4，最多 8），不再出现第 5 轮必 400。
- 单轮工具调用上限按「尝试数」计：失败调用同样占额度，模型无法靠反复提交同一组错误参数把一轮跑满。
- 块库读取失败不再被当成空库：`list_blocks` 与 `insert_block` 明确回报「块库当前不可用……不是空库」，模型据此改走绘图工具或提示用户稍后重试，而不是凭空重画库里已有的符号。
- 技能面板的「有用率 / 采纳率」在采纳或反馈回执成功后立即刷新，不需要重开面板；无轮询。
- 技能编辑器手写路径的校验与导入路径、后端规则合一（工具名、上下文信号、字段长度、数值范围），此前只有导入路径拦得住脏数据。
- brief 档上下文补上一行事实（有无标注、块引用数、隐藏 / 锁定图层数）；standard 档图层截断从 `…+N more` 改为「…另有 N 个图层（1 个隐藏、1 个锁定）」。
- 计划与多方案里的编辑步骤不再被整份拒绝：后端校验计划步骤时不再要求 `ids`，作用对象改为在用户确认时按当前选择集解析（此前 `{tool: "move_elements"}` 这类步骤会被判 `NO_TARGET` 导致整份计划被丢弃），直接调用编辑工具时规则不变（[ADR 0017](docs/adr/0017-ai-gap-closing-and-conventions-downstream.md)）。
- 技能 Playbook 的全部字段真正进入提示词：此前 `steps` / `checks` / `examples` / `requiredContext` / `negativeKeywords` / `version` 只存在于数据模型，模型看不到；现在按技能成块输出，反关键词渲染为「不适用场景」。
- 只读设计工具结果统一走字符预算裁剪，`check_drawing` 改为读取项目设计约定，不再出现超大返回体撑爆上下文。
- 后端技能写入校验与前端对齐：`steps[].tool` 必须是已知工具名，`selectionTypes` 必须是最长 32 字的非空字符串，绕过前端直接调接口也无法写入脏数据。
- 注册页「返回登录」按钮此前传了不存在的 `onLoginClick` 属性、点击无响应，现已接通。
- 版本记忆补齐「修改数」：此前只统计新增 / 删除，「改了尺寸但没增减图元」的版本在记忆里表现为无变化；现按轻量几何签名比较，版本列表显示 `+N / -M / ~K`，存量摘要缺字段时按 0 处理。

### Added

- 一键发布到共享生产服务器（与 AIDriveAll / AIDriveNote 同一套机制）：本地 `scripts/deploy-remote.sh` 先做端口占用预检，再 rsync 工作区、ssh 触发服务器侧非交互 `deploy.sh`（`docker compose -f docker-compose.prod.yml up -d --build` → 等库就绪 → 容器内迁移 → 就绪探针与页面自检），最后从外网校验 `https://aiignite.com.cn/cad/health`。新增 `docker-compose.prod.yml`、`Dockerfile.prod` 与 `deploy/nginx/cad.conf`（子路径静态资源、`/cad/api` 反代、SSE 免缓冲、`/cad/socket.io/` 升级），前后端只绑定 `127.0.0.1`、由共享网关对外暴露；`scripts/init-server-env.sh` 首次生成服务器 `.env`（随机 `POSTGRES_PASSWORD` / `JWT_SECRET` / `ENCRYPTION_KEY`，权限 600），仓库不再需要任何生产密钥。详见 [docs/guides/DEPLOYMENT.md](docs/guides/DEPLOYMENT.md)。
- 方案对比卡片按草稿上的几何差分显示「新增 N / 修改 M / 移除 K」，全为 0 时显示「无几何变化」，不再只信模型自述的步骤数；连续的同工具同参数调用会在 toolResult 里提示模型换做法，但不直接拒绝（[ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md)）。
- 块目录读取结果带上可用性标记（`getBlockCatalog` 返回 `{ entries, ok }`），Agent 草稿据此区分「块库不可用」与「块库为空」。
- 技能统计刷新信号 `store/skillStats.ts`：轻量外部 store + `useSyncExternalStore`，回执成功即通知订阅方。
- 补充测试：`tests/skillStats.test.ts`（订阅 / 退订）、`tests/aiAgentLoop.test.ts`（失败调用占额度、重复调用提示、几何差分计数）、`tests/aiTools.test.ts`（字段级错误与块库不可用文案）、`tests/designTools.test.ts`（`list_blocks` 不可用与空库区分）、`tests/aiContext.test.ts`（brief 档事实行与图层截断计数）、`tests/aiSseEvents.test.ts`（轮次上限取服务端）、`tests/skillValidation.test.ts`（编辑器与导入共用规则）；`tests/e2e/aiChat.spec.ts` 断言方案卡片刻度；后端 `backend/tests/llmChatAgent.test.ts` 补消息序列合法与提示词含写工具清单两条。
- 项目设计约定下沉到确定性检查：检查面板、AI 质量门禁与 `check_drawing` 工具统一按约定核对图层归属（未登记图层给警告、约定图层为空给提示）与文字字高是否统一（[ADR 0017](docs/adr/0017-ai-gap-closing-and-conventions-downstream.md)）。
- 技能采纳率闭环：轮次回执新增 `skillCodes`，`GET /api/skills/stats` 同时聚合主观反馈与客观采纳，给出 `adoptionRate`；未评价 / 未决策不计入分母。
- 块目录缓存：按项目缓存 60 秒，块或分类增删改后立即失效，避免每一轮 AI 请求都重新拉取整棵块树。
- 补齐 React 类型依赖（`@types/react` / `@types/react-dom`，devDependencies）：此前组件 props 与 state 全部退化为 `any`，类型检查形同虚设；补齐后暴露并修复 4 处历史问题。
- 差距报告 [docs/reports/AI_CAPABILITY_GAP_REPORT.md](docs/reports/AI_CAPABILITY_GAP_REPORT.md)：P0–P3 规划项逐条核对结论、两轮共 21 项差距与 4 项已知限制。
- 第二轮补差 [ADR 0018](docs/adr/0018-ai-tool-contract-and-rejection-loop.md) 已实施（G11–G21），要点见上方 Fixed / Added。
- 补充测试：`tests/designTools.test.ts`（约定三类规则）、`tests/previewReview.test.ts`（门禁读约定）、`backend/tests/blocks.test.ts`（块目录展开图元）、`backend/tests/toolValidation.test.ts`（计划步骤不要求 ids）、`backend/tests/chatSessions.test.ts`（回执写入技能归属）、`backend/tests/versionMemory.test.ts`（修改数统计）。
- 块与符号复用：新增只读工具 `list_blocks` 与写入工具 `insert_block`；每轮请求前把 `/api/blocks/tree` 压成扁平块目录注入 Agent 草稿，插入时在草稿上展开为图元，沿用预览与单步撤销管线（[ADR 0016](docs/adr/0016-block-reuse-quality-gate-and-feedback.md)）。
- AI 结果质量门禁：预览弹窗自动对改动前后跑同一套确定性检查规则，只把本轮新增的问题算作 AI 引入；error 级问题必须显式勾选确认才能应用，warning / info 仅提示（[ADR 0016](docs/adr/0016-block-reuse-quality-gate-and-feedback.md)）。
- 回答反馈闭环：每条 AI 回答可标记「有帮助 / 没帮助」并附原因，反馈写回该轮助手消息 metadata；新增 `GET /api/skills/stats` 按技能 code 统计 up / down 与有用率，技能面板显示「有用 X%（N）」。
- 技能导入导出：技能可导出为带版本号的 `aiignite-skill` v1 JSON，导入时在浏览器侧严格校验（未知工具、未知上下文信号、超长字段、越界数组一律拒绝并说明原因），代码冲突时自动追加副本后缀并在预览中确认。
- 补充 P3 覆盖：`tests/blockCatalog.test.ts`、`tests/previewReview.test.ts`、`tests/skillTransfer.test.ts`、`backend/tests/chatSessions.test.ts`（反馈路由）、`backend/tests/skills.test.ts`（有用率统计），以及 `tests/e2e/aiChat.spec.ts`、`tests/e2e/skills.spec.ts` 的浏览器级用例。
- 设计约定：项目级制图标准、单位、字高、标注精度、图层规则与备注，存 `projects.design_conventions`，随项目同步；右侧导航新增「约定」面板，每轮 AI 请求自动注入约定摘要（[ADR 0015](docs/adr/0015-design-conventions-and-variants.md)）。
- 版本记忆：创建版本时对比上一版快照计算新增 / 删除数、类型分布与涉及图层，写入 `project_versions.change_summary`；最近 5 个版本连同提交信息注入 prompt，版本列表显示 `+N / -M`。
- 多方案生成：新增 `propose_variants` 控制工具与方案模式（只读工具 + `propose_variants` 白名单）；模型给出 2–3 个备选方案，每个方案在草稿独立执行并渲染缩略预览，采用其中一个后只走一次预览、只占一步撤销。
- 参考图转 CAD：页头「Trace」打开本地参考图矢量化，按阈值用 marching squares 提取轮廓、RDP 简化后生成 `LWPOLYLINE` 到 `TRACE` 图层，可调阈值 / 反色 / 简化 / 目标宽度，预览确认后一次插入；图片只在本机 Canvas 读取，不上传。
- 补充 P2 覆盖：`tests/aiVariants.test.ts`、`tests/imageTrace.test.ts`、`backend/tests/designConventions.test.ts`、`backend/tests/versionMemory.test.ts`、`tests/e2e/conventions.spec.ts`、`tests/e2e/trace.spec.ts`。
- 设计操作工具：新增 `align_elements` / `distribute_elements` / `dimension_chain` / `assign_layer` / `delete_elements`，纯几何实现集中在 `lib/designOps.ts`，沿用预览与单步撤销管线（[ADR 0014](docs/adr/0014-design-ops-plan-and-review.md)）。
- 计划模式：复杂请求先由只读工具确认现状，再通过 `propose_plan` 提交带工具与参数的计划；计划卡片支持改标题、调顺序、删步骤，确认后本地执行并只弹一次预览，不额外请求模型。
- 图纸检查面板：右侧导航新增「检查」，按错误 / 警告 / 提示列出确定性规则问题，支持筛选、选中并缩放定位、忽略与「让 AI 修复」；检查规则新增文字重叠与图层未整理提示。
- 补充计划模式与检查面板的单元 / 集成 / E2E 覆盖：`tests/aiPlan.test.ts`、`tests/e2e/review.spec.ts`，后端校验计划参数与 `planMode` 工具白名单；工具夹具扩展到 49 条、26 个工具。
- 技能 Playbook：`ai_skills` 新增执行步骤、完成检查、示例请求、所需设计上下文、反关键词与 `version`；promptComposer 按小标题注入，技能编辑器支持编辑全部字段并在更新后递增版本（[ADR 0013](docs/adr/0013-skill-playbook-design-context.md)）。
- 设计上下文包：brief / standard / deep 三档摘要，覆盖项目、单位、图层可见性与锁定、块引用、标注覆盖、隐藏对象、修订号与更多选中图元细节；由问题类型与图纸规模自动选档。
- 三个只读设计工具：`query_elements`、`measure_geometry`、`check_drawing` 在浏览器草稿上确定性执行，参数经服务端边界校验，结果按字符预算裁剪后回传模型。
- 技能编辑器的步骤 / 检查 / 示例 / 上下文信号字段与 Playbook 回填，新增 `tests/e2e/skills.spec.ts` 浏览器级覆盖。
- 20 条设计任务级离线评测（`backend/tests/designTaskEval.test.ts`），覆盖技能路由、工具白名单、草稿执行与 Playbook 注入；工具夹具扩展到 44 条、21 个工具。
- 结构化 JSON 日志与 `X-Request-Id` 请求链路追踪，敏感字段自动脱敏。
- `/api/metrics` 指标端点：请求量、错误率、P50/P95/P99 延迟、AI 失败率、SSE 中断率、同步积压。
- `/api/telemetry/events` 前端错误与同步状态批量上报。
- Playwright 6 条冒烟 E2E 与 CI job；`npm run docs:screenshots` 自动生成文档截图。
- AI Function Calling 工具集（11 个工具）与文本 JSON 降级路径，附带离线评测。
- 同步幂等键、服务端去重、最后写入胜冲突标记与用户提示。
- `docs/adr`、`docs/architecture`、`docs/guides`、`docs/reports` 文档分层与 `examples/` 示例。
- MIT License、CONTRIBUTING、PR / Issue 模板。
- 命令行注册表：命令别名、位置参数、`HELP`、`Tab` 补全、`↑↓` 历史与必填参数分步提示；新增命令不再修改 `App.tsx`。
- 画布工具拆分为独立状态机（`tools/*Tool.ts`），hook 只保留坐标转换、捕捉与事件分发。
- 版本历史：手动命名保存、每 20 次提交自动版本（60 秒失败退避）、版本预览与两版对比、恢复后可 Ctrl+Z 回退并立即持久化。
- 后端 `versions` 路由与 `elementCount` 元数据列，列表分页且详情按需加载。
- AI 变更预览弹窗：展示净变化、结果预览与计划动作，确认后整批只占一步撤销；`CLEAR` 与批量删除（≥5）需显式勾选确认。
- 全局 `ErrorBoundary`：渲染崩溃时提供重试、刷新与复制诊断信息，并上报组件栈遥测。
- AI 上下文摘要替代全量图元 JSON；`/api/llm/chat` 记录 prompt/completion token、上下文字符与延迟，新增 `ai.tokens.*`、`ai.context_chars` 指标，Provider 未返回 usage 时自动估算。
- 图框 / 打印：A4–A0 / Letter、横竖版、适配或固定比例、可配置边距与标题栏、单色输出，预览与打印共用同一矢量图纸；浏览器“另存为 PDF”即可输出矢量 PDF。
- AI 模型注册表与解析链：显式选择 → 会话绑定 → 助手模型 → 用户默认 → 系统默认 → 任一启用模型，逐级校验归属与 `supportsTools`；Provider 失败且未吐出内容时按候选顺序故障转移并发出 `model_fallback` 事件。
- CAD 工具集扩展到 18 个（新增 `draw_arc` / `draw_dimension` / `scale_elements` / `offset_elements` / `array_elements` / `get_canvas_info` / `zoom_to_selection`），前后端定义共用一份白名单。
- 助手配置真正生效：系统提示词注入 prompt、工具白名单收窄可用集合、`maxToolRounds` 限制工具轮次。
- 技能系统：内置种子技能（基础绘图 / 几何编辑 / 阵列与偏移 / 圆弧与曲线 / 标注与注释 / 布局规划 / 图纸审查）与用户自建技能同表存储，按显式固定 > 助手绑定 > 关键词 > 选择集类型 > 会话连续性打分路由，阈值以下不激活，单轮最多 3 个。
- AI Agent 工具循环运行在前端虚拟画布：模型每轮一次 HTTP 请求，浏览器在草稿元素数组上执行工具并回传 `toolResults`，整批结果只在 `AIPreviewModal` 预览一次、确认后一步撤销。
- 服务端持久化对话：`chat_sessions` / `chat_messages` 记录角色、工具调用、工具结果与 token；确定性 `clientMessageId` 保证续轮重放幂等，历史可完整回放工具参数与执行状态。
- 会话上下文压缩：超出字符预算时生成确定性 digest 写入 `contextSummary` 并记录水位线，不再逐条注入早期消息；新增 `ai.context_compacted`、`ai.context_dropped` 指标。
- `ai_call_logs` 调用台账与回合结果回写（`applied` / `discarded` + 原因），可统计 token 成本与被用户接受的 AI 方案比例。
- 右侧面板新增模型 / 助手 / 技能三个管理视图，与对话视图共用一份注册表状态；`/api/skills`、`/api/chat` 路由补齐。
- 极轴追踪：`lib/polar.ts` 以 45° 增量、10° 容差把光标吸附到极轴方向并绘制引导线，与正交互斥，状态栏「极轴」开关生效。
- 可编辑动态输入：绘制中可在光标旁键入长度 / 角度 / 宽高，`Tab` 切换字段、`Enter` 提交；`lib/dynamicInput.ts` 判定可键入阶段并把数值合成为终点。
- 预选高亮与捕捉标签：选择 / 复制 / 修剪工具下光标经过图元即变浅蓝（区别于选中黄色），捕捉类型以中文标签跟随光标与状态栏显示。
- 直线 / 矩形 / 圆支持「点击—移动—点击」两步绘制，单击保留锚点后也可直接键入数值提交。
- 画布内 AI 幽灵预览：`lib/aiGhost.ts` 把 AI 差分换算成「提议（紫色虚线）/ 将移除（红色虚线）」叠加到真实图纸，预览弹窗可收起为底部工具条，在图纸上下文中核对落点后再应用。
- AI 落图后脉冲高亮：受影响图元以 1.2s 动画指出改动位置，`prefers-reduced-motion` 下自动关闭；通知条同步给出「已应用 AI 变更 · N 个图元 · Ctrl+Z 可撤销」。
- 选中集迷你工具栏：选框上方浮出移动 / 复制 / 旋转 / 缩放 / 镜像 / 偏移 / 阵列 / 删除 / 问 AI，工具按钮复用左侧工具栏的工具态；「问 AI」把选择集摘要写成对话草稿并聚焦输入框。
- 键盘效率体系：`F3` / `F7` / `F8` / `F10` 直接切换捕捉 / 栅格 / 正交 / 极轴并提示开关结果；命令行留空按 `Enter` 重复上一条命令。
- 隔离与选择同类：`ISOLATE` / `HIDEOBJECTS` / `SHOWALL` / `SELECTSIMILAR` 基于独立的临时隐藏集（`lib/isolation.ts`），被隐藏的图元不渲染、不参与捕捉与框选，但不改图层可见性也不占用撤销步骤；状态栏「已隐藏 N」点击即恢复。
- 视图命令与命名视图：视口抽为瞬态外部 store（`store/viewport.ts`），缩放 / 平移不进撤销历史也不标记图纸已修改；新增 `ZOOM E|S|W` 与 `VIEW SAVE|RESTORE|LIST`，命名视图按图纸存于浏览器本地。
- 快速选择：新增 `QSELECT` 命令与 `lib/quickSelect.ts`，按类型 / 图层 / 颜色三维过滤（维度间取交集、维度内取并集），过滤面板实时预览命中数量，确认后写入选择集。
- 迷你导航图：画布右下角常驻小地图（`components/MiniMap.tsx` + `lib/minimap.ts`），缩略显示全部可显示图元并叠加视口矩形，点击或拖拽即移动视口；只读视口，不占撤销步骤。
- AI 视图工具 `zoom_to_selection`：只移动视口、不改图纸，因此不进预览、不占撤销步骤（例外规则见 [ADR 0011](docs/adr/0011-ai-view-tools-bypass-preview.md)）。
- 点击循环选择：图元重叠时在同一位置 300ms 内重复点击可在命中列表中依次切换（后绘制者优先）；多选状态下点击成员仍保留整个选择集以便整体拖动。
- 工具栏分组：左侧工具条按 导航 / 绘图 / 修改 常驻高频工具，低频工具收进「更多工具」溢出菜单并按 绘图 / 修改 / 标注 / 参数化 分组展示。
- 实验性实时协作：状态栏「协作 实验」开关接入 Socket.IO 项目房间，广播图元差集与远端光标，全员可写、最后写入胜；远端补丁不占本地撤销步骤（[ADR 0012](docs/adr/0012-experimental-collaboration.md)）。
- 渲染器抽象：新增 `renderer/types.ts` 的 `Renderer` 接口与 `renderer/svgRenderer.ts`，坐标换算、命中测试与视口缓冲从组件中剥离，为后续 Canvas 2D 评估保留替换点。
- 拖拽与平移按 `requestAnimationFrame` 合并更新（`lib/frameCoalescer.ts`），高频 mousemove 不再逐次重渲染画布。
- 2000 元素渲染基准（`tests/performance.test.ts`）：记录索引构建、首帧静态渲染与连续平移帧预算，阈值按 50 FPS 设定。
- 欢迎页新增「三步上手」与内置示例图纸（齿轮 / 弹簧 / 建筑平面），示例 DXF 由 `node scripts/generate-examples.mjs` 生成。
- README 顶部新增「90 秒跑起来」代码块，与 `start.sh` 的实际命令一致；新增 30 秒演示 GIF（`npm run docs:gif`）。
- 后端新增 `/ready` 数据库就绪探针；前端遥测事件携带构建版本号、会话 ID 与最近 20 条操作序列。

### Security

- 前端构建不再把 `GEMINI_API_KEY` 内联进公开 bundle（`vite.config.ts` 的 `define` 与 `Dockerfile` 的 `ARG/ENV` 一并移除）：产物是公网静态资源，任何构建期注入的密钥都能被直接读出；AI 密钥只保留在服务端 `.env`，由后端代理调用 Provider。
- 认证写操作与 `/api/llm/chat` 增加进程内限流（默认 20 次 / 15 分钟、30 次 / 分钟），返回 `429`、`Retry-After` 与 `RateLimit-*` 头；只读的 `GET /api/auth/me` 不计数。
- `/api/llm/chat` 增加请求体 schema 校验，非法参数在触达数据库与 Provider 前返回 400。
- `/api/llm/chat` 校验扩展到完整 Agent 回合契约：`phase` 枚举、`round` 上界、`pinnedSkillCodes` ≤5、`canvasContext` 与 `toolResults` 条数与字段长度上限；`/api/chat/*` 会话读写新增独立限流（默认 120 次 / 5 分钟，`CHAT_RATE_LIMIT_MAX/WINDOW_MS`）。
- 模型 `baseUrl` 增加 SSRF 校验（协议、私网/回环与 https 要求），内网可信端点需显式配置 `AI_ALLOWED_ENDPOINTS`；LLM 凭据响应只返回 `hasApiKey` 与脱敏预览，`apiKeyEncrypted` 统一剔除。
- helmet 显式配置严格 CSP、一年期 HSTS、`X-Frame-Options: DENY` 与 `Referrer-Policy: no-referrer`，关闭 `X-Powered-By`。
- 生产环境缺少 `JWT_SECRET` 时启动失败；认证路由改用结构化日志。
- CI 新增前后端 `npm audit --omit=dev --audit-level=high`；升级 lockfile 修复生产依赖中的 critical/high 漏洞。
- Socket.IO 握手校验 JWT，加入房间前校验项目归属；所有广播要求发送方已加入对应项目房间，补丁与光标载荷做条数与形状校验，堵住跨项目广播与超大包。

### Changed

- `deploy.sh` 从本地交互式菜单改为服务器侧非交互脚本（构建 → 等库就绪 → 迁移 → 自检，任一环节失败即非零退出）；本地临时栈继续用 `docker-compose.yml`（`localhost:3220`），生产用 `docker-compose.prod.yml`。`docs/guides/DOCKER_UPDATE_GUIDE.md` 的过期端口 3400/3410/5435 与 `docker-compose` 命令统一为 3220/3225/5432 与 `docker compose`。
- 命令行输入控制器抽离为 `hooks/useCommandInput.ts`，历史持久化至 localStorage。
- 画布提示统一到状态栏：删除画布顶部 8 处英文提示，`lib/toolHints.ts` 按工具与已取点阶段输出「工具 · 下一步」。
- 交互界面文案中文化（工具栏、状态栏、AI 变更预览、绘图设置的捕捉项），捕捉类型标签由 `lib/snapping.ts` 单点提供。
- 工具栏按钮增加 `data-tool` 标识，E2E 选择器不再依赖可见文案。
- AI 预览确认改为按差分增量落图，预览期间的手动作图不会被整表覆盖丢弃；仍是确认后一次 `commitAction`、一步撤销。
- `Delete` 键与迷你工具栏共用 `requestDeleteSelection`：≥5 个图元仍要求显式确认，删除后立即给出可撤销提示。
- 图元可显示判定收敛到 `lib/isolation.ts`：画布命中测试、框选与 `SELECTALL` 使用同一套「隐藏图层 + 临时隐藏集」规则，不再各写一份过滤。
- 技能路由改为「先判意图、再放大信号」：选择集类型与设计上下文只在关键词/固定/绑定/连续性命中时加分，避免仅选中图元就激活编辑与阵列技能；审查技能激活时本轮只下发只读工具。
- 对话作用域改用稳定的项目标识（`chatKey`）：本地项目 id 被服务端 id 替换后不再把刚发生的本地回合刷掉。
- 同步队列不再丢弃进行中的保存请求：上一轮 flush 未结束时到达的请求会在结束后补跑一轮，项目元数据（如设计约定）不再滞留本地。

### Removed

- 删除无引用的 `services/geminiService.ts` 与 `RightPanel` 中的死导入。

## [0.1.0] - 2026-10-21

### Added

- 基础 2D CAD 编辑器：直线、多段线、圆、圆弧、矩形、文字。
- 编辑工具：选择、移动、复制、修剪、镜像、旋转、缩放、偏移、矩形阵列。
- 尺寸标注、距离测量与 11 种 HATCH 填充图案。
- 参数化图形：齿轮、渐开线、螺旋、弹簧、正多边形、椭圆。
- 曲线生成与校验：正弦 / 余弦、对数螺旋、贝塞尔、圆弧。
- DXF 导入导出（LINE / CIRCLE / ARC / LWPOLYLINE / TEXT）。
- Blocks 块系统：定义、引用、嵌套、变换、分类树与循环引用检测。
- AI 对话绘图：多 Provider（OpenAI / Anthropic / Google / Ollama）SSE 流式输出。
- 用户注册登录、JWT 鉴权、项目隔离、LLM API Key AES-256-GCM 加密存储。
- IndexedDB 离线优先存储与 PostgreSQL 同步队列。
- 图层管理、属性检查器、命令行、夹点编辑、对象捕捉。
- 撤销 / 重做（命令模式，支持快照回退开关）。
- 视口裁剪、空间索引与元素级 memo 渲染。
- 前端 / 后端单元测试、CI（lint / typecheck / test / build）。

### Changed

- 选择集从图元字段迁移为独立瞬态状态 `selectedIds`。
- 画布交互逻辑拆分到 `hooks/useCanvasInteraction.ts`，渲染与预览分离。
- 前后端类型统一以根目录 `types.ts` 为准。

### Fixed

- 曲线生成器对点数与连续性的校验，正弦波异常自动修正。
- 保存与撤销粒度：连续属性输入合并为一次历史记录。
- 同步重试可能重复创建项目 / 元素的问题。

[Unreleased]: https://github.com/aiignite/AIIgniteCAD/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/aiignite/AIIgniteCAD/releases/tag/v0.1.0
