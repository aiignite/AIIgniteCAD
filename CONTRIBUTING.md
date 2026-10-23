# 贡献指南

感谢参与 AIIgniteCAD。本文说明本地开发、提交规范与评审要求，帮助改动顺利合入。

## 环境搭建

```bash
npm install
(cd backend && npm install)
cp .env.example .env
cp backend/.env.example backend/.env
git config core.hooksPath .githooks
docker compose up -d db
(cd backend && npx prisma migrate deploy && npx prisma generate)
```

启动：

```bash
(cd backend && npm run dev)   # http://localhost:3225
npm run dev                   # http://localhost:3220
```

完整步骤与故障排除见 [QUICKSTART.md](QUICKSTART.md)。

## 开发流程

1. 从 `main` 创建分支：`feat/<topic>`、`fix/<topic>`、`docs/<topic>`、`refactor/<topic>`。
2. 先写或更新测试，再改实现。
3. 本地通过全部检查（见下）。
4. 提交 PR，填写变更动机、验证方式与风险点。
5. 至少一位维护者评审通过后合并；合并方式默认 Squash。

## 提交前检查

```bash
# 前端
npm run lint
npm run typecheck
npm test
npm run build

# 后端
(cd backend && npm run lint && npx tsc --noEmit && npm test)

# 涉及交互 / 鉴权 / 保存链路时
npm run test:e2e
```

- 任何新增行为必须有对应测试；纯 UI 调整至少提供截图。
- 修复缺陷时优先补一个能复现问题的回归测试。
- 不为了让检查通过而删除断言、跳过测试或关闭 ESLint 规则。

## 提交信息

遵循 [Conventional Commits](https://www.conventionalcommits.org/)：

```
feat: 新增矩形阵列参数面板
fix: 修复离线重试导致重复创建项目
docs: 补充同步幂等设计说明
refactor: 拆分画布交互状态机
test: 增加 AI 工具调用参数校验用例
chore: 升级 Playwright 至 1.64
```

- 第一行不超过 72 字符，说明“为什么”而不是“改了什么文件”。
- 一个 PR 聚焦一个主题；无关重构请拆开。

## 代码规范

详见 [AGENTS.md](AGENTS.md)。关键点：

- 前端 4 空格、后端 2 空格；Prettier 配置以 `.prettierrc` 为准。
- 新增代码不允许 `any`、`console.log` 或未处理 Promise。
- 纯函数放 `lib/`，IO / 浏览器依赖放 `services/`。
- 状态变更走 `store/`，不要在组件内复制全局状态。
- Prisma schema 变更必须包含迁移文件。
- 新增接口需考虑鉴权、参数校验、幂等与指标埋点。

## 安全

- **不要提交** `.env`、`backend/.env`、API Key、JWT、数据库密码或生产地址。
- 日志与错误响应不得包含密钥；使用 `logger` 自动脱敏。
- 发现安全漏洞请私下联系维护者，不要在公开 Issue 中贴出利用细节或凭据。
- PR 中如包含 `package-lock.json` 变更，请说明新增 / 升级依赖的原因。

## 文档

- 根目录只保留六个入口文档，其余内容放入 `docs/` 对应子目录。
- 架构决策新增 ADR：`docs/adr/NNNN-title.md`，状态从 `Proposed` 开始。
- 指南放 `docs/guides/`，历史报告放 `docs/reports/`。
- README 截图通过 `npm run docs:screenshots` 生成。

## PR 模板

提交 PR 时请包含：

- **What**：改了什么，关联 Issue。
- **Why**：解决什么问题，为什么采用该方案。
- **How to test**：复现 / 验证步骤，附命令或截图。
- **Risk**：兼容性、数据迁移、性能或安全影响。
