# 快速开始：30 分钟跑通并导出 DXF

目标：从零启动前端 + 后端 + PostgreSQL，注册账号，创建图纸，画线并导出 DXF。

## 0. 前置条件

| 依赖 | 版本 | 检查命令 |
| --- | --- | --- |
| Node.js | 20 LTS 或更高 | `node -v` |
| npm | 9+ | `npm -v` |
| Docker + Compose | 可选，用于数据库或一键部署 | `docker compose version` |
| Git | 任意较新版本 | `git --version` |

不需要 LLM API Key。AI 对话是可选能力。

## 1. 获取代码并安装依赖（约 5 分钟）

```bash
git clone git@github.com:aiignite/AIIgniteCAD.git
cd AIIgniteCAD

npm install
(cd backend && npm install)
```

启用密钥拦截钩子，避免 `.env` 被误推送：

```bash
git config core.hooksPath .githooks
```

## 2. 配置环境变量（约 5 分钟）

```bash
cp .env.example .env
cp backend/.env.example backend/.env
```

本地开发需要保证数据库账号密码一致。若使用 `docker compose up -d db` 启动数据库，请按 `.env` 中的值配置 `backend/.env`：

```bash
# .env
POSTGRES_USER=aiignite
POSTGRES_PASSWORD=change_me
POSTGRES_DB=ai_ignite_cad

# backend/.env
DATABASE_URL="postgresql://aiignite:change_me@localhost:5432/ai_ignite_cad"
```

生产或公网环境必须替换以下密钥：

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # ENCRYPTION_KEY（用于加密数据库中的 LLM API Key）
```

## 3. 启动数据库并初始化（约 10 分钟）

```bash
docker compose up -d db
(cd backend && npx prisma migrate deploy && npx prisma generate)
```

确认数据库已就绪：

```bash
docker compose ps
# aiignite-cad-postgres 应为 healthy
```

> 若曾用其他账号启动过该数据卷，需重置：`docker compose down -v`（会清空本地数据）。

## 4. 启动前后端（约 5 分钟）

打开两个终端：

```bash
# 终端 A
cd backend
npm run dev
# HTTP:   http://localhost:3225
# Health: http://localhost:3225/health

# 终端 B（项目根目录）
npm run dev
# Web: http://localhost:3220
```

后端启动日志为单行 JSON；看到 `Backend server started` 即成功。也可以使用脚本：

```bash
./start.sh all       # 同时启动
./start.sh stop      # 停止
```

## 5. 验证并导出（约 5 分钟）

1. 打开 <http://localhost:3220>，注册账号并登录。
2. 在欢迎面板点击 **New Drawing**，输入名称后创建。
3. 点击左侧工具栏的 **Line**，在画布上拖动画一条线。
4. 点击右上角 **Export**，浏览器下载 `.dxf` 文件。
5. 用任意文本编辑器打开，应能看到 `SECTION`、`ENTITIES`、`LINE`。
6. 点击 **Save**，刷新页面，从最近文件重新打开，图形应恢复。

验证清单：

- [ ] `curl http://localhost:3225/health` 返回 `status: OK`
- [ ] 注册 / 登录成功，刷新后仍保持登录
- [ ] 可以画线、圆、矩形，并选中 / 删除
- [ ] 导出 DXF 且包含 `ENTITIES`
- [ ] 保存后刷新可以从服务端恢复
- [ ] `curl http://localhost:3225/api/metrics` 返回指标 JSON

## 6. 可选：启用 AI

1. 点击顶部工具栏的 **AI 助手** 图标打开对话窗，可拖动、缩放，或切换为右侧抽屉。
2. 在窗口内的**模型设置**抽屉新增 OpenAI / Anthropic / Google / Ollama 模型并填写 API Key（后端以 AES-256-GCM 加密落库，接口只回传脱敏预览）。
3. **助手管理**可配置系统提示词、允许使用的 CAD 工具白名单与最大工具轮次，并把助手绑定到某个模型；**技能管理**列出内置与自建技能，按关键词、选择集类型等规则自动激活，也可在对话里手动固定。
4. 回到对话输入框，用自然语言绘图，例如：

```text
画一个 200×120 的矩形，在右侧画一个半径 40 的圆。
把选中的图形向右移动 50。
```

模型不支持 Function Calling 时会自动降级为文本 JSON 解析；对话历史保存在服务端，刷新或换设备后仍可回放。详细提示词示例见 [examples/ai-prompts.md](examples/ai-prompts.md)，机制说明见 [README 的 AI 章节](README.md#ai模型助手技能与工具循环)。

## 使用 Docker 一键启动（可选）

```bash
cp .env.example .env   # 填入 JWT_SECRET 与 ENCRYPTION_KEY
docker compose up -d --build
```

- 前端：<http://localhost:3220>
- 后端：<http://localhost:3225>
- 健康检查：<http://localhost:3225/health>

数据库连接由 Compose 注入，无需修改 `backend/.env`。

## 导入 DXF / DWG

- 顶部 **Import** 可选择 `.dxf` 或 `.dwg`；DXF 在浏览器内直接解析，DWG 上传到后端由 `dwg-converter` 转成 ASCII DXF 后走同一条预览 / 撤销路径。
- `docker compose up -d --build` 会一并构建 `dwg-converter`。首次构建需要源码编译 LibreDWG，通常要几分钟。
- 非 Docker 本地开发：`docker build -t aiignite-cad-dwg-converter dwg-converter`，`docker run --rm -p 3310:3310 aiignite-cad-dwg-converter`，再在 `backend/.env` 设置 `DWG_CONVERTER_URL=http://localhost:3310` 并重启后端。
- 默认单文件上限 50 MB（`DWG_MAX_FILE_MB`），转换超时 60 秒（`DWG_CONVERT_TIMEOUT_MS`）。已支持块引用、MTEXT、DIMENSION；`SPLINE` / `HATCH` 等暂不导入。

## 故障排除

### 数据库连接失败

```bash
docker compose ps
docker compose logs db --tail=50
psql "postgresql://aiignite:change_me@localhost:5432/ai_ignite_cad" -c "select 1"
```

- Docker 内主机名为 `db`，本机开发为 `localhost`。
- 确认 `.env` 与 `backend/.env` 的用户名、密码、库名一致。

### 端口被占用（3220 / 3225 / 5432）

```bash
lsof -i :3220 -i :3225 -i :5432
./start.sh stop
docker compose down
```

### Prisma 报错 `idempotencyKey` 不存在或 Client 未生成

```bash
cd backend
npx prisma generate
npx prisma migrate deploy
```

### 前端能打开但接口 401 / CORS

- 确认 `backend/.env` 的 `FRONTEND_URL=http://localhost:3220`。
- 确认根目录 `.env` 的 `VITE_API_URL=http://localhost:3225/api`，修改后重启 Vite。
- 清理过期 token：浏览器控制台执行 `localStorage.removeItem("auth_token")` 后重新登录。

### AI 无响应

```bash
curl http://localhost:3225/health
curl http://localhost:3225/api/metrics | jq '.ai_requests, .ai_failures, .ai_failovers'
```

对话面板的错误条会带上错误码，按码排查：

| 错误码 | 含义 | 处理 |
| --- | --- | --- |
| `NO_MODEL_CONFIGURED` | 没有可用模型 | 到**模型**面板添加并启用一个模型 |
| `MODEL_DISABLED` | 会话绑定的模型已停用 | 重新启用模型，或在对话顶部改选模型 |
| `MODEL_FORBIDDEN` | 模型不属于当前用户 | 换成自己的模型；`userId=null` 的系统模型可正常使用 |
| `TOOL_ROUND_LIMIT` | 工具轮次达到助手上限 | 先预览当前结果，或调高助手的最大轮次 |
| `RATE_LIMITED` | 触发限流 | 按 `Retry-After` 等待，或调整 `AI_RATE_LIMIT_MAX` |

仍无响应时检查后端日志中的 `LLM chat finished`，确认 provider、Base URL 与密钥有效；局域网 OpenAI 兼容网关使用 HTTP 时，后端设 `AI_ALLOW_PRIVATE_ENDPOINTS=true`，内网域名（如 `ccswitch.lan`、`host.docker.internal`）还需加入 `AI_ALLOWED_ENDPOINTS`。

## 下一步

- [README.md](README.md) — 功能、架构与命令
- [CONTRIBUTING.md](CONTRIBUTING.md) — 开发与提交规范
- [docs/README.md](docs/README.md) — 架构、指南、ADR 索引
