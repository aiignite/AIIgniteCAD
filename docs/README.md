# 文档索引

根目录只保留稳定入口文档；本目录承载架构、指南、历史报告与架构决策记录。

## 稳定入口

| 文档                                     | 说明                       |
| ---------------------------------------- | -------------------------- |
| [../README.md](../README.md)             | 产品概览、功能、架构与命令 |
| [../QUICKSTART.md](../QUICKSTART.md)     | 30 分钟安装、验证与导出    |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 开发流程与提交规范         |
| [../AGENTS.md](../AGENTS.md)             | 面向编码 Agent 的仓库约定  |
| [../CHANGELOG.md](../CHANGELOG.md)       | 版本变更记录               |

## 架构（architecture）

| 文档                                                                                  | 说明                            |
| ------------------------------------------------------------------------------------- | ------------------------------- |
| [CAD_ENGINE_ARCHITECTURE.md](architecture/CAD_ENGINE_ARCHITECTURE.md)                 | CAD 引擎分层与算法注册表        |
| [AI_FLOW_ANALYSIS.md](architecture/AI_FLOW_ANALYSIS.md)                               | AI 请求、流式输出与工具调用链路 |
| [DATABASE_DESIGN.md](architecture/DATABASE_DESIGN.md)                                 | PostgreSQL / Prisma 数据模型    |
| [BLOCKS_IMPLEMENTATION_PLAN.md](architecture/BLOCKS_IMPLEMENTATION_PLAN.md)           | 块系统设计                      |
| [PROPERTY_INSPECTOR_ARCHITECTURE.md](architecture/PROPERTY_INSPECTOR_ARCHITECTURE.md) | 属性检查器结构                  |

## 指南（guides）

| 文档                                                                    | 说明                           |
| ----------------------------------------------------------------------- | ------------------------------ |
| [DEPLOYMENT.md](guides/DEPLOYMENT.md)                                   | 生产部署                       |
| [DOCKER_UPDATE_GUIDE.md](guides/DOCKER_UPDATE_GUIDE.md)                 | Docker 更新流程                |
| [CAD_ENGINE_QUICKSTART.md](guides/CAD_ENGINE_QUICKSTART.md)             | CAD 引擎快速上手               |
| [ADVANCED_SHAPES_GUIDE.md](guides/ADVANCED_SHAPES_GUIDE.md)             | 高级参数化图形                 |
| [PROPERTY_INSPECTOR_GUIDE.md](guides/PROPERTY_INSPECTOR_GUIDE.md)       | 属性检查器使用                 |
| [PROPERTY_INSPECTOR_EXAMPLES.md](guides/PROPERTY_INSPECTOR_EXAMPLES.md) | 属性检查器示例                 |
| [CHAT_QUICK_START.md](guides/CHAT_QUICK_START.md)                       | AI 对话快速上手                |
| [DEMO_SCRIPT.md](guides/DEMO_SCRIPT.md)                                 | 演示脚本                       |
| [NOTEBOOK_LLM_RESOURCES.md](guides/NOTEBOOK_LLM_RESOURCES.md)           | Notebook / LLM 资源            |
| [TESTING.md](guides/TESTING.md)                                         | 测试用例映射、CI 与指标名清单       |
| [IMPLEMENTATION_GUIDE.md](guides/IMPLEMENTATION_GUIDE.md)               | 历史实施指南（部分内容已过时） |

## 架构决策（adr）

| 编号                                                          | 决策                                                              |
| ------------------------------------------------------------- | ----------------------------------------------------------------- |
| [0001](adr/0001-svg-rendering.md)                             | 使用 SVG 渲染 2D 画布                                             |
| [0002](adr/0002-command-pattern-history.md)                   | 使用命令模式实现撤销 / 重做                                       |
| [0003](adr/0003-offline-first-sync.md)                        | 离线优先 + 幂等同步 + 最后写入胜                                  |
| [0004](adr/0004-ai-tool-calling.md)                           | AI 优先工具调用，保留文本 JSON 降级                               |
| [0005](adr/0005-ai-preview-single-undo.md)                    | AI 动作先预览后应用，合并为单次撤销                               |
| [0006](adr/0006-ai-context-summary-token-metrics.md)          | 画布上下文摘要与 token / 延迟计量                                 |
| [0007](adr/0007-api-hardening.md)                             | API 硬化：限流、请求校验、安全头与依赖审计                        |
| [0008](adr/0008-error-boundary-telemetry.md)                  | 全局 ErrorBoundary 与客户端遥测                                   |
| [0009](adr/0009-plot-and-title-block.md)                      | 图框 / 打印使用毫米坐标系与矢量输出                               |
| [0010](adr/0010-ai-agent-core-loop.md)                        | AI Agent 核心闭环：模型解析链、助手、技能路由与前端工具循环       |
| [0011](adr/0011-ai-view-tools-bypass-preview.md)              | 视图类工具绕过 AI 变更预览                                        |
| [0012](adr/0012-experimental-collaboration.md)                | 实验性实时协作：房间广播与最后写入胜                              |
| [0013](adr/0013-skill-playbook-design-context.md)             | 技能 Playbook 与设计上下文包                                      |
| [0014](adr/0014-design-ops-plan-and-review.md)                | 设计操作工具、计划模式与图纸检查面板                              |
| [0015](adr/0015-design-conventions-and-variants.md)           | 项目设计约定、版本记忆与多方案生成                                |
| [0016](adr/0016-block-reuse-quality-gate-and-feedback.md)     | 块复用、AI 质量门禁、反馈闭环与技能导入导出                       |
| [0017](adr/0017-ai-gap-closing-and-conventions-downstream.md) | 差距收敛：约定下沉确定性检查、Playbook 全量注入、计划目标延迟解析 |
| [0018](adr/0018-ai-tool-contract-and-rejection-loop.md)       | 工具契约收敛：可引用工具集、拒绝回环、轮次上限下发                |

## 差距报告（reports）

| 文档                                                               | 说明                                                         |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| [AI_CAPABILITY_GAP_REPORT.md](reports/AI_CAPABILITY_GAP_REPORT.md) | P0–P3 规划项与实现的逐条核对结论、两轮共 21 项差距与已知限制 |

## 历史报告（reports）

`reports/` 保留各阶段实现、验收与修复记录（块系统、属性检查器、正弦波修复、部署总结等）。这些文档反映当时状态，其中的文件路径、测试数量与功能描述可能已过时；当前行为以代码、README 与 ADR 为准。

## 截图

`images/` 由 `npm run docs:screenshots` 生成，源文件见 `tests/e2e/screenshots.spec.ts`。
