# 测试与可观测性清单

本文承载**易随实现漂移的清单**：测试文件与用例映射、指标名与响应字段。README 只保留稳定入口，新增或删除测试、增删指标时更新本文即可，不必改动 README。

## 门禁命令

```bash
# 前端
npm run lint && npm run typecheck && npm test && npm run build

# 后端
(cd backend && npm run lint && npx tsc --noEmit && npm test)

# E2E（改动交互 / 保存 / 鉴权时）
npm run test:e2e

# 生产依赖审计（CI 同样执行，high/critical 阻断）
npm audit --omit=dev --audit-level=high
```

| 命令                       | 作用                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `npm test`                 | 前端 Vitest，配置见 `vitest.config.ts`（Node 环境，不加载浏览器） |
| `npm run test:watch`       | 前端监听模式                                                      |
| `npm run test:coverage`    | v8 覆盖率，只统计纯逻辑模块（配置内 `coverage.include`）          |
| `(cd backend && npm test)` | 后端 Vitest + Supertest，Prisma 用 `vi.mock` 替换，无需数据库     |
| `npm run test:e2e`         | Playwright（`playwright.config.ts`），`page.route` 模拟 API       |
| `npm run docs:screenshots` | 重新生成 `docs/images/*.png`                                      |
| `npm run docs:gif`         | 录制帧并合成 `docs/images/demo.gif`                               |

后端测试在 `backend/vitest.config.ts` 里固定了测试用 `JWT_SECRET` / `ENCRYPTION_KEY`，并把各类限流上限调到 1000——限流行为只由 `backend/tests/rateLimit.test.ts` 显式覆盖。测试文件中不写真实 API Key、JWT 或数据库密码。

## 前端单元测试（`tests/`）

| 文件 | 覆盖内容 |
| --- | --- |
| `geometry.test.ts` | 基础度量与向量运算 |
| `transform.test.ts` | 移动、复制等图元变换 |
| `canvasTools.test.ts` | 各绘制工具状态机（含 HATCH 请求打开填充对话框与未接线时的明确提示） |
| `selection.test.ts` | 框选方向（窗口 / 交叉）判定 |
| `quickSelect.test.ts` | 快速选择的类型 / 图层 / 颜色过滤 |
| `clickCycle.test.ts` | 重叠图元点击循环选择 |
| `isolation.test.ts` | 隔离与临时隐藏集 |
| `snapping.test.ts` | 捕捉点与交点计算 |
| `polar.test.ts` | 极轴角度约束 |
| `dynamicInput.test.ts` | 动态输入锚点与数值合成 |
| `toolHints.test.ts` | 状态栏「工具 · 下一步」提示 |
| `grip.test.ts` | 夹点计算 |
| `viewport.test.ts` | 视口缩放 |
| `minimap.test.ts` | 导航图几何 |
| `namedViews.test.ts` | 命名视图校验 |
| `spatialIndex.test.ts` | 空间网格索引：矩形 / 点查询、`queryVisible` 顺序与精确相交、退化包围盒兜底、与全量过滤等价 |
| `frameCoalescer.test.ts` | 渲染帧合并 |
| `renderer.test.ts` | SvgRenderer 坐标换算与命中测试 |
| `plot.test.ts` | 图框布局、比例与线宽 |
| `command.test.ts` | 命令模式撤销 / 重做历史 |
| `commands.test.ts` | 命令行解析与参数分步 |
| `dxf.test.ts` | DXF 导出与导入解析 |
| `dxfUnits.test.ts` | DXF `$INSUNITS` 单位换算、导入 / 导出报告（跳过项、块展开超限）与单位往返 |
| `dxfWorker.test.ts` | DXF Worker 客户端：并发 id 匹配、错误消息、崩溃后主线程回退、超时、dispose 与无 Worker 环境回退 |
| `offset.test.ts` | 偏移几何正确性：法向平移与相邻段顶点取交、自交与退化判定、开放多段线、失败原因分类 |
| `shapeRegeneration.test.ts` | 参数化图元重算与同步策略：仅移中心平移轮廓 vs 形状参数变化重算、螺旋起始半径旧存档推导 |
| `crossDrawing.test.ts` | 跨图纸快照插入：包围盒左下角对齐、重新编号与共享分组、块引用跳过、上限截断 |
| `projectConsistency.test.ts` | 项目一致性：单位 / 字高 / 精度 / 制图标准 / 约定图层清单差异、重名、空图纸、约定缺失 |
| `examples.test.ts` | `examples/*.dxf` 可解析 |
| `curveGeneration.test.ts` | 正弦 / 余弦等曲线生成 |
| `block.test.ts` | 块定义管理、引用变换与插入语义（平移量 = 插入点 − 基点，符号展开复制） |
| `blockCatalog.test.ts` | 块目录检索与展开为图元 |
| `syncService.test.ts` | 同步队列、按项目合并、图层与绘图设置随项目更新上传 |
| `indexedDBSaveElements.test.ts` | IndexedDB 元素快照事务替换与跨项目隔离 |
| `projectDocument.test.ts` | 统一文档模型：旧存档迁移、Decimal 字符串收敛、非法图元 / 图层 / 设置拒绝、适配器往返 |
| `indexedDBSaveDocument.test.ts` | 文档级原子保存：图元 / 图层 / 设置整份替换、旧存档回退迁移、删除连带清设置 |
| `collaboration.test.ts` | 图元差集补丁、房间快照合并与截断、广播基线推进（发送失败不丢修改） |
| `collaborationClient.test.ts` | 协作客户端：断线不推进基线、状态请求 / 快照收发与截断、入站载荷校验 |
| `telemetry.test.ts` | 遥测批量上报 |
| `versionDiff.test.ts` | 版本对比 |
| `performance.test.ts` | 2000 / 10000 元素视口裁剪与平移帧预算（含索引构建耗时） |

### AI 相关

| 文件 | 覆盖内容 |
| --- | --- |
| `aiTools.test.ts` | 工具调用转换与文本 JSON 降级两条路径 |
| `aiActions.test.ts` | `computeAIActionOutcome` 差分与撤销粒度 |
| `aiAgentLoop.test.ts` | 前端工具循环与计划识别 |
| `aiPlan.test.ts` | 计划解析与执行转换（含步骤可引用写工具） |
| `aiVariants.test.ts` | 多方案解析与执行转换 |
| `aiContext.test.ts` | 上下文分档摘要（brief 档事实行、图层截断计数、项目图纸行） |
| `aiSseEvents.test.ts` | SSE 行解析与事件类型 |
| `aiChatHistory.test.ts` | 历史回放与反馈状态还原 |
| `aiGhost.test.ts` | 幽灵预览计划 |
| `designOps.test.ts` | 对齐 / 分布 / 图层 / 删除 |
| `designTools.test.ts` | 查询 / 测量 / 检查（含 `scope=project` 跨图纸）/ 修复摘要，含写工具字段级错误 |
| `planReview.test.ts` | 计划预检：步骤分类、逐步模拟、问题归因到步骤、失败步骤不抛错 |
| `changeExplanation.test.ts` | 变更说明：几何摘要、按图层聚合、截断与可复制文本 |
| `previewReview.test.ts` | 预览结果门禁的差集计算（同一条问题需描述一致才算旧问题） |
| `imageTrace.test.ts` | 轮廓提取、RDP 简化与缩放 |
| `skillTransfer.test.ts` | 技能导入导出校验 |
| `skillValidation.test.ts` | 技能字段校验（编辑器手写路径） |
| `skillStats.test.ts` | 技能统计刷新信号 |

## 后端单元测试（`backend/tests/`）

| 文件 | 覆盖内容 |
| --- | --- |
| `health.test.ts` | 健康探针 |
| `cors.test.ts` | 允许来源解析 |
| `securityHeaders.test.ts` | CSP / HSTS / frame / referrer |
| `observability.test.ts` | `requestId`、结构化日志与指标 |
| `rateLimit.test.ts` | 各类限流窗口与 429 行为 |
| `auth.test.ts` | 注册 / 登录 / 鉴权，含资料与修改密码的受保护边界 |
| `projects.test.ts` | 项目接口鉴权、归属、稳定元素 id 增量保存、图层整份替换与绘图设置 upsert（含载荷校验） |
| `versions.test.ts` | 项目版本接口 |
| `blocks.test.ts` | 块目录接口 |
| `skills.test.ts` | 技能管理接口与写入校验 |
| `assistants.test.ts` | 助手接口 |
| `llmModels.test.ts` | 模型注册表接口 |
| `sync.test.ts` | 同步幂等、冲突与稳定元素 id 保存 |
| `collaborationProtocol.test.ts` | 补丁 / 光标 / 房间快照 sanitize 与应答成员选择 |
| `aiModelResolver.test.ts` | `resolveChatModel` 解析链 |
| `aiPromptComposer.test.ts` | 系统提示词组装 |
| `aiSkillRouter.test.ts` | 技能打分与激活 |
| `aiContextManager.test.ts` | 历史 digest 与压缩 |
| `aiUsage.test.ts` | token 估算与 usage 归一 |
| `toolCalls.test.ts` | CAD 工具定义与 provider 载荷转换 |
| `toolValidation.test.ts` | `validateToolCall` 参数校验 |
| `urlGuard.test.ts` | `assertSafeLLMEndpoint` SSRF 校验 |
| `llmChatValidation.test.ts` | `/api/llm/chat` 请求体校验 |
| `llmChatTools.test.ts` | 工具调用链路 |
| `llmChatAgent.test.ts` | Agent 编排（含拒绝回环的消息序列、计划模式写工具清单） |
| `designConventions.test.ts` | 设计约定归一化与注入 |
| `versionMemory.test.ts` | 版本差异摘要 |
| `designTaskEval.test.ts` | 设计任务级评测：技能路由 → 工具白名单 → 草稿执行 → Playbook 注入，无需真实 API Key |

技能字段校验由前端 `tests/skillValidation.test.ts` 与后端 `skills.test.ts` 分别覆盖，两端共用同一组错误文案。

## E2E（`tests/e2e/`）

全部通过 `page.route` 拦截 API，**不需要数据库或真实 API Key**。

| 规格 | 场景 |
| --- | --- |
| `smoke.spec.ts` | 启动、登录、画线、导出冒烟 |
| `aiChat.spec.ts` | 对话 → 工具 → 块插入 → 计划 → 方案对比 → 门禁 → 反馈 → 撤销全流程 |
| `review.spec.ts` | 检查面板定位与「让 AI 修复」 |
| `skills.spec.ts` | 技能编辑器与导入导出 |
| `conventions.spec.ts` | 设计约定保存与注入 |
| `trace.spec.ts` | 参考图转 CAD 插入 |
| `screenshots.spec.ts` | 生成 `docs/images/` 截图 |
| `demoGif.spec.ts` | 生成分帧，供 `scripts/make-demo-gif.sh` 合成 GIF |

## CI

`.github/workflows/ci.yml` 在 PR 上并行三个 job：

| Job | 内容 |
| --- | --- |
| Frontend | `npm ci` → 生产依赖 audit → lint → typecheck → test → build |
| Backend | `npm ci` → Prisma generate → audit → lint → typecheck → test |
| E2E | 安装 Playwright 浏览器 → `npm run test:e2e`，失败时上传 report 工件 |

## 指标与响应字段

`GET /api/metrics` 返回 `timestamp`、`uptimeSeconds`、`memory.{rssBytes,heapUsedBytes}`，以及 `counters` / `gauges` / `histograms` 与派生 `rates`。直方图提供 `p50 / p95 / p99`。配置 `METRICS_TOKEN` 后需 `Authorization: Bearer <token>`。

| 名称 | 类型 | 含义 |
| --- | --- | --- |
| `http.requests` | counter | 请求总量 |
| `http.responses.status_<code>` | counter | 按状态码分布 |
| `http.duration_ms` | histogram | 请求时延 |
| `http.active_requests` | gauge | 在途请求 |
| `http.errors.client` / `http.errors.server` / `http.errors.unhandled` | counter | 4xx / 5xx / 未捕获异常 |
| `http.rate_limited` | counter | 限流命中 |
| `sse.started` / `sse.active` / `sse.<outcome>` | counter / gauge / counter | 流开始、在途、结束原因（含 `aborted`） |
| `rates.aiFailureRate` | 派生 | `ai.failures / ai.requests` |
| `rates.sseAbortRate` | 派生 | `sse.aborted / sse.started` |
| `ai.requests` / `ai.failures` | counter | AI 请求量与失败量 |
| `ai.failovers` | counter | Provider 故障转移次数 |
| `ai.request_retries` / `ai.transport_retries` / `ai.tool_fallback_retries` | counter | HTTP 重试、传输重试、工具降级重试 |
| `ai.aborted` | counter | 客户端中断 |
| `ai.tool_calls` / `ai.tool_rejected` | counter | 工具调用与被拒数 |
| `ai.duration_ms` | histogram | 单次模型调用耗时 |
| `ai.context_chars` | histogram | 发送上下文规模 |
| `ai.context_compacted` / `ai.context_dropped` | counter | 历史压缩次数与丢弃条数 |
| `ai.tokens.prompt` / `ai.tokens.completion` | histogram | token 用量 |
| `ai.call_logs` / `ai.log_write_failures` | counter | 台账写入成功 / 失败 |
| `ai.turns_applied` / `ai.turns_discarded` | counter | 回合采纳与放弃（`discarded` 带 `reason`） |
| `ai.feedback_up` / `ai.feedback_down` | counter | 回答反馈计数 |
| `ai.skills_seeded` / `ai.skills_created` / `ai.skills_cloned` | counter | 技能种子写入、创建与克隆 |
| `sync.projects.created` / `sync.projects.deleted` | counter | 项目新建与删除 |
| `sync.project_updates` / `sync.element_saves` / `sync.saved_elements` | counter | 更新次数与落库元素数 |
| `sync.conflicts` / `sync.duplicate_requests` | counter | 冲突与幂等重复命中 |
| `versions.created` | counter | 版本创建数 |
| `client.events` / `client.errors` | counter | 遥测上报事件数与其中错误数 |

计数器与限流桶都在**进程内存**中，重启清零、多实例不共享；需要跨实例聚合时应对接外部采集。Token 统计优先使用 Provider 返回的 `usage`，缺失时按 4 字符 ≈ 1 token 估算并在 `AiCallLog` 标记 `usageEstimated`。
