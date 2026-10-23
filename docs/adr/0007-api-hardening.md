# ADR 0007：API 硬化——限流、请求校验、安全头与依赖审计

- **状态**：Accepted
- **日期**：2026-10-21
- **决策者**：后端与安全团队

## 背景

`/api/auth/*` 与 `/api/llm/chat` 是公网可达且成本敏感的入口：前者可被暴力尝试密码，后者会消耗第三方模型额度。AI 请求体此前直接解构，缺少长度与类型约束；安全头沿用 helmet 默认值，未针对纯 API 明确 CSP/HSTS；CI 也没有阻断已知漏洞依赖。

## 决策

### 限流

- 新增 `backend/src/middleware/rateLimit.ts`，使用进程内固定窗口计数，返回 `429 Too Many Requests`、`Retry-After` 与 `RateLimit-Limit/Remaining/Reset`。
- 认证写操作（注册 / 登录 / 资料与密码修改）默认每 IP 每 15 分钟 20 次；只读的 `GET /api/auth/me` 不计数；AI 对话默认每用户每分钟 30 次。
- 配额可通过 `AUTH_RATE_LIMIT_MAX/WINDOW_MS`、`AI_RATE_LIMIT_MAX/WINDOW_MS` 调整；`RATE_LIMIT_DISABLED=true` 仅用于紧急排障。
- 触发限流时记录 `http.rate_limited` 指标与结构化日志（不含请求体）。

### 请求校验

- `/api/llm/chat` 使用 express-validator 校验：`message` 必填、字符串、trim 后非空、≤ 32000 字符；`assistantId` / `modelId` 为 ≤ 128 字符的字符串；`enableTools` 为布尔值。
- 校验失败在访问数据库与 Provider 之前返回 400，响应包含首个错误信息与 `requestId`。

### 安全头与密钥

- helmet 显式配置：CSP `default-src 'none'`、`frame-ancestors 'none'`、`base-uri 'none'`、`form-action 'none'`、`object-src 'none'`；HSTS 一年并包含子域；`X-Frame-Options: DENY`；`Referrer-Policy: no-referrer`。
- 关闭 `X-Powered-By`。
- 生产环境缺少 `JWT_SECRET` 时启动即失败，不再回退到开发默认值。

### 供应链

- CI 的前端与后端任务在安装依赖后执行 `npm audit --omit=dev --audit-level=high`，生产依赖出现 high/critical 漏洞即阻断合并。

## 理由

- 单体服务已有进程内 metrics，内存限流不引入额外基础设施即可覆盖暴力尝试与额度滥用。
- 在入口处拒绝畸形请求，比在 Provider 调用后再处理更便宜、更安全。
- 纯 API 不承载 HTML，最严格的 CSP 不会影响功能，却能限制被直接访问时的能力。
- 依赖漏洞应在 CI 而非上线后暴露。

## 后果

- 进程内计数在多实例/重启后不共享，水平扩容前必须替换为 Redis 等共享存储。
- 按 IP 限流在反向代理后需要正确配置 `trust proxy`，否则所有用户共享代理 IP 的配额。
- 32k 字符上限与每分钟 30 次是初始值，需根据真实用量调整。
- 若未来由后端托管前端静态资源，CSP 必须放宽并重新评审。
- 开发依赖的漏洞不在此门禁范围内，仍需定期单独审计。

## 相关

- `backend/src/middleware/rateLimit.ts`、`backend/src/app.ts`、`backend/src/routes/llmChat.ts`
- `backend/tests/rateLimit.test.ts`、`backend/tests/llmChatValidation.test.ts`、`backend/tests/securityHeaders.test.ts`
- `.github/workflows/ci.yml`、`backend/.env.example`
