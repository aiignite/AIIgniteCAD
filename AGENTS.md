# AGENTS.md

面向编码 Agent 的仓库工作约定。修改代码前请先读完本文件；产品说明见 [README.md](README.md)，环境搭建见 [QUICKSTART.md](QUICKSTART.md)。

## 1. 仓库概览

- **前端**：React 19 + TypeScript + Vite 6，SVG 2D 画布（Y 轴向下），Tailwind CSS。
- **后端**：Express 4 + Prisma 5 + PostgreSQL 15，JWT 鉴权，SSE 流式 LLM。
- **状态**：`store/canvasStore.tsx`（画布 / 历史）与 `store/appStore.tsx`（会话 / 文件 / 通知），Context + useReducer。
- **纯函数**：`lib/`（geometry / transform / selection / snapping / aiTools），不得依赖 React 或浏览器 API。
- **服务层**：`services/`（DXF、块、填充、IndexedDB、同步、REST/SSE、遥测）。
- **文档**：根目录只保留 README / QUICKSTART / CONTRIBUTING / CHANGELOG / LICENSE / AGENTS；其余归档到 `docs/architecture|guides|reports|adr`。

## 2. 安装与运行

```bash
npm install
(cd backend && npm install)
cp .env.example .env
cp backend/.env.example backend/.env
docker compose up -d db
(cd backend && npx prisma migrate deploy && npx prisma generate)
(cd backend && npm run dev)   # http://localhost:3225
npm run dev                   # http://localhost:3220
```

## 3. 提交前必须通过的检查

```bash
npm run lint
npm run typecheck
npm test
npm run build

(cd backend && npm run lint && npx tsc --noEmit && npm test)
npm run test:e2e   # 改动交互 / 保存 / 鉴权时
```

- 单元测试：前端 `tests/**/*.test.ts`；后端 `backend/tests/**/*.test.ts`。
- E2E：`tests/e2e/*.spec.ts`，通过 `page.route` 模拟 API，无需数据库或 LLM Key。
- 截图：`npm run docs:screenshots` 会重新生成 `docs/images/`。
- 不在测试或日志中写入真实 API Key、JWT 或数据库密码。

## 4. 代码风格

### 格式

- 前端 4 空格缩进；后端 2 空格缩进。
- Prettier：双引号、分号、尾逗号、`printWidth: 100`。提交前可运行 `npm run format`。
- ESLint：前端 flat config（`eslint.config.js`），后端 `.eslintrc.json`。不要新增 `any`；现有告警不强制清零，但新增代码应保持 0 error。
- 注释只解释“为什么”，不要复述代码；避免大段文件头注释。

### 导入

```ts
import React, { useState, useCallback } from "react";
import { ToolType, CADElement, Point } from "../types";
import { exportToDXF } from "../services/dxfService";
```

- 前端根目录文件使用相对路径；`@/*` 别名可用，但现有代码以相对路径为主。
- 类型统一来自根目录 `types.ts`，不要在 `backend/` 重复定义前端类型。
- 纯函数放 `lib/`，带副作用 / IO 的放 `services/`。

### 命名

- 组件 PascalCase（`Canvas.tsx`），工具与算法 camelCase（`dxfService.ts`）。
- 类型 / 接口 PascalCase；常量 UPPER_SNAKE_CASE。
- 元素 id 使用 `lib` 中现有生成器，不要直接 `Math.random()` 拼接。

### 图标

- 图标使用本地 Material Symbols 子集（`public/fonts/material-symbols/material.woff2`），不走 CDN。
- `material-symbols-outlined` 里的名字必须是子集已有的连字名，否则界面直接渲染成英文文本；新增图标前先确认，例如：
  `python3 -c "from fontTools.ttLib import TTFont; print('send' in set(TTFont('public/fonts/material-symbols/material.woff2').getGlyphOrder()))"`。

### 界面样式

- 颜色只用 `cad.*` token（`tailwind.config.js`），底层是 `index.css` 的 RGB 三元组变量；不要引入裸的 `gray-*/blue-*/white` 等原色，浅色主题会立即走样。
- 悬停反馈统一 `hover:bg-cad-text/10`（危险操作用 `red-500/10` 系），同类控件不要另造透明度。
- 字号三档：正文 `text-xs`（12px）、辅助标签 `text-[11px]`、坐标 / 数值读数保持 `text-[10px]` mono；不再新增 9/15/17px 等非标字号。
- 图标三档：16px 行内、18px 普通按钮、20px 工具栏主图标。
- 圆角：模态 / 面板 `rounded-lg`，按钮 / 输入 `rounded` 或 `rounded-md`，徽标保持 `rounded-full`。
- 主题走 `store/theme.ts`（持久化 + 跟随系统）；新增面板不要在渲染期读 `localStorage`，布局偏好统一走 `lib/uiPreferences.ts`。
- 用户可见文案必须走 `lib/i18n.tsx` 的 `t()`，中英字典同时补齐（`tests/i18n.test.ts` 兜底）；不要在组件里硬编码中文或英文句子。

### TypeScript

- 保持 strict，禁止隐式 `any`；外部数据先收窄再使用。
- 组件使用函数式写法，不用 class。
- 复杂状态用 discriminated union，避免“字段全可选”的对象。

## 5. 架构边界

### 画布与交互

- `Canvas.tsx` 只负责渲染与组合；坐标转换、捕捉、pan/zoom 与事件分发在 `hooks/useCanvasInteraction.ts`。
- 各工具状态机位于 `tools/`，实现 `CanvasTool` 并在 `tools/index.ts` 注册；新增工具不需要修改 hook 的分支逻辑。
- 新增工具时同时接入：工具栏、命令行、类型定义、`tools/XTool.ts`、测试。
- 屏幕坐标 → 世界坐标必须走既有转换函数；不要在各组件内重复实现。
- 选择集是独立瞬态状态（`selectedIds`），不要写回图元对象。
- 打印布局统一走 `lib/plot.ts` + `components/PlotSheet.tsx`；图元打印样式通过 `CADElementRenderer` 的 `overrides` 传入，不要复制一套图元渲染逻辑。

### 历史与撤销

- 撤销基于 `lib/command.ts` 的命令模式；`canvasStore` 默认使用增量历史。
- 连续属性输入需合并为一步撤销（参见 `App.tsx` 中 400ms 防抖提交）。
- 设置 `VITE_HISTORY_MODE=snapshot` 可回退到快照模式，改动历史逻辑时两种模式都不能崩。

### 持久化与同步

- 所有编辑先写 IndexedDB，再进入 `syncQueue`；不要绕过队列直接调用 API。
- 同步写入必须带 `Idempotency-Key`；重试不得产生重复项目或重复元素。
- 冲突策略为最后写入胜，响应 `conflict` 必须转成用户可见提示。
- 离线新建项目的服务端 id 回填必须同步更新本地文件、当前文件与已保存快照。

### 版本历史

- 快照结构统一由 `lib/versionSnapshot.ts` 生成；恢复必须通过 `commitAction` 写入撤销历史并立即持久化，不能直接覆盖元素状态。
- 版本列表只读元数据（`elementCount`），详情按需加载；分页以 `versionNumber` 为游标。
- 自动版本每 20 次提交触发一次，失败后 60 秒退避；不要在渲染或 memo 中触发写请求。
- 后端 versions 路由必须校验项目归属；版本号在事务内取 max + 1，唯一冲突返回 409。

### AI

- 工具名与参数定义在 `backend/src/services/aiEngine/tools.ts` 与 `lib/aiTools.ts`，两处必须一致。
- 前端优先处理 `toolCall`，同时保留文本 JSON 降级路径；两条路径都要有测试。
- 任何 AI 生成的参数在写入画布前必须校验；非法参数丢弃并记录。
- AI 动作必须先经过 `computeAIActionOutcome` 计算、再由 `AIPreviewModal` 预览，确认后一次 `commitAction`；不要绕过预览直接写入。
- `CLEAR` 或一次删除 ≥5 个图元必须要求用户显式确认；批量 AI 动作只能占一步撤销。
- 发送上下文使用 `summarizeCanvasContext`，禁止把完整图元 JSON 塞进 prompt。
- 日志中禁止出现 API Key、Authorization 头或完整请求体；数值型 token 计数不属于敏感字段。

### 后端

- 路由只做参数校验、鉴权、调用 Prisma 与响应；复杂逻辑下沉到 `lib/` 或 `services/`。
- 请求处理使用 `requestId` + `logger`，不要新增 `console.log`。
- 新增写接口时考虑幂等；新增耗时操作时补充 `metrics.observe/increment`。
- Prisma schema 变更必须附带 `backend/prisma/migrations/` 迁移文件。

## 6. 安全

- 绝不提交 `.env`、`backend/.env`、密钥、真实 token；只提交 `.env.example`。
- 错误信息与日志不得包含 API Key、密码、Authorization 头；使用 `logger` 的脱敏能力。
- 外部输入（DXF、AI 参数、请求体）必须做边界校验。
- 认证与 AI 路由必须经过 `backend/src/middleware/rateLimit.ts`；新增高成本接口时同步评估配额与指标。
- 安全头集中在 `backend/src/app.ts` 配置（CSP / HSTS / frame / referrer），不要在路由里零散添加。
- 生产环境必须提供 `JWT_SECRET`；禁止恢复默认密钥回退。
- CI 会执行 `npm audit --omit=dev --audit-level=high`，引入生产依赖后先本地跑一遍。
- 不跳过 Git hooks，不使用 `--no-verify` 或关闭签名。

## 7. 文档

- 新增架构决策写入 `docs/adr/`（复制现有模板编号递增）。
- 使用指南写入 `docs/guides/`；历史实现报告归档到 `docs/reports/`，不要往根目录新增 Markdown。
- README 只保留稳定信息；易变的测试数量、指标数值不要写死。
- 截图通过 `npm run docs:screenshots` 生成，不要手工替换来源不明的图片。
