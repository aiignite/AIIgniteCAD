# 部署指南

本项目有两种部署路径：**发布到共享服务器**（生产）与**本机 Docker 试跑**（演示 / 验证）。
两者用的镜像定义不同，不要混用配置文件。

| 场景         | 编排文件                     | 前端入口                    | 说明                                        |
| ------------ | ---------------------------- | --------------------------- | ------------------------------------------- |
| 生产发布     | `docker-compose.prod.yml`    | `https://aiignite.com.cn/cad/` | 前端走 `Dockerfile.prod`，产物挂在 `/cad/` 子路径 |
| 本机 Docker  | `docker-compose.yml`         | `http://localhost:3220`     | 根路径模式，走 `Dockerfile` + `nginx.conf`  |

开发环境（不走 Docker）见 [QUICKSTART.md](../../QUICKSTART.md)。

## 前置要求

- Docker 20.10+ 与 Docker Compose v2（`docker compose` 子命令，不是 `docker-compose`）
- 生产发布还需：本机 `rsync` / `ssh` / `curl`，服务器上的 SSH 登录，以及宿主机已配置共享网关
  （nginx + certbot，域名 `aiignite.com.cn`）

## 一、发布到服务器

### 槽位约定

站点挂在共享域名的 `/cad/` 子路径下，容器只绑回环，公网入口统一由宿主机网关转发：

- 前端容器 → 宿主机 `127.0.0.1:3220`（由 `location /cad/` 反代）
- 后端容器 → 宿主机 `127.0.0.1:3245`（不对外暴露，仅排障时直连）
- Postgres → 不发布任何宿主机端口，只在 compose 网络内可达

> `/cad/` 与 `3220` 此前由另一个同名 CAD 项目使用。接管该槽位会让它下线；
> `scripts/deploy-remote.sh` 在同步前会检测端口被谁占用并中止，需要你显式停掉对方容器。
> 对方的数据卷不动，回滚只需重新 `up` 它的栈。

### 1. 首次初始化（只做一次）

```bash
cp scripts/deploy.env.example scripts/deploy.env   # 填服务器地址；该文件已被 .gitignore 忽略
bash scripts/deploy-remote.sh --init-env           # 同步代码并在服务器上生成生产配置
ssh ubuntu@<服务器> 'nano /home/ubuntu/AIIgniteCAD/.env'   # 至少补上 GEMINI_API_KEY
```

`scripts/init-server-env.sh` 会随机生成 `POSTGRES_PASSWORD`、`JWT_SECRET`、`ENCRYPTION_KEY`、
`METRICS_TOKEN`，写入服务器仓库根目录的 `.env`（权限 600）。

两条不可违反的约定：

- **生产配置只存在于服务器上的 `.env`**。本地 `.env` 与 `backend/.env` 属于开发环境，rsync 阶段被排除，
  不会被同步上去，也不会覆盖服务器上的值。
- **`ENCRYPTION_KEY` 不能随意更换**。数据库里的 LLM Key 用 AES-256-GCM 以它加密，换掉后历史密文无法解密。

### 2. 日常发布

```bash
bash scripts/deploy-remote.sh
```

脚本按 AIDriveAll / AIDriveNote 的同一套机制执行：

1. `rsync` 当前工作区到 `/home/ubuntu/AIIgniteCAD`（排除 `node_modules`、`.git`、`.env`、
   `dist`、`coverage`、`playwright-report`、`scripts/deploy.env` 等）；
2. 预检宿主机 `3220` 是否被其它项目的容器占用（`--init-env` 首次初始化会跳过这一步）；
3. ssh 执行服务器上的 `deploy.sh`：`docker compose -f docker-compose.prod.yml up -d --build` →
   等待 `pg_isready` → 在 backend 容器内 `npx prisma migrate deploy` → 自检三个端点；
4. 从外部验证 `https://aiignite.com.cn/cad/health` 与页面。

> 迁移其实在 **backend 容器启动时就已应用**（启动流程里带 fail-fast 的 `migrate deploy`，日志中会出现
> `Database migrations applied`），`deploy.sh` 第 3 步的迁移是幂等兜底，多数时候只会打印
> `No pending migrations to apply.`。所以迁移失败会表现为容器反复重启而不是脚本报错，
> 排查时先看 `logs backend` 而不是只看 `deploy.sh` 的输出。

> rsync 是增量覆盖、不删除远端多余文件，也不会重置服务器 `.env`。
> 发布内容 = 本地工作区，因此发布前先确认工作区就是你想上线的代码。要上线干净的提交而不是在写的功能，
> 先从该提交开一个临时 worktree 再从那里跑（脚本按自身所在目录确定发布根目录）：
>
> ```bash
> git worktree add --detach /tmp/cad-release <要上线的提交>
> AIIGNITECAD_DEPLOY_CONFIG="$PWD/scripts/deploy.env" \
>   bash /tmp/cad-release/scripts/deploy-remote.sh
> git worktree remove /tmp/cad-release
> ```

### 网关与已知限制

宿主机网关里已经有一条 `location /cad/ { proxy_pass http://127.0.0.1:3220; }`，带 `proxy_buffering off`
与 `X-Accel-Buffering: no`，所以 SSE 对话不需要改网关，接管槽位后直接可用。

该 location 显式设了 `proxy_set_header Connection ''` 且没有转发 `Upgrade`，浏览器无法在 `/cad/` 下建立
WebSocket。实时协作（实验特性、默认关闭）会自动退回 HTTP 长轮询，功能不受影响；要用 WebSocket 得在共享
网关里加一条 `location /cad/socket.io/`，那是共享基础设施变更，需在 AIDriveAll 侧一起改。

服务器 4 GB 内存 + 10 GB swap，`npm run build` 峰值会吃掉 1 GB 以上；先停掉旧栈再发布可以留出余量，
构建期间页面响应会变慢属于预期。

首次发布还会构建 `dwg-converter`（从源码编译 LibreDWG），在 4 GB 机器上会额外花几分钟；之后构建有缓存。
构建阶段优先从 GNU 主站下载源码，超时后回退阿里云镜像，并用固定 SHA256 校验；`deploy.sh` 设了
`COMPOSE_PARALLEL_LIMIT=1` 串行构建，避免 LibreDWG 编译与前端 vite 同时抢内存。
DWG 上传体由 `deploy/nginx/cad.conf` 的 `client_max_body_size 55m` 放行，共享网关若配置了更小的上限，
需要同步放宽到 55 MB 以上，否则大图纸会在网关层直接返回 413。

### 3. 排障

```bash
# 后端日志（含 requestId 结构化输出）
ssh ubuntu@<服务器> 'cd ~/AIIgniteCAD && docker compose -f docker-compose.prod.yml logs --tail=100 backend'

# 迁移状态
ssh ubuntu@<服务器> 'cd ~/AIIgniteCAD && docker compose -f docker-compose.prod.yml run --rm --no-deps backend npx prisma migrate status'

# 直连后端（绕开前端 nginx）
ssh ubuntu@<服务器> 'curl -s localhost:3245/ready'
```

图标按钮显示成 `send`、`folder_open` 这类英文单词时，是 Material Symbols 字体没加载：

```bash
curl -s https://aiignite.com.cn/cad/fonts/material-symbols/material-symbols-local.css | grep 'src: url'
curl -sI https://aiignite.com.cn/cad/fonts/material-symbols/material.woff2 | grep -i 'content-type\|cache-control'
```

`src` 必须是相对自身的 `url(material.woff2)`，字体必须返回 `font/woff2`。写成绝对路径
`/fonts/...` 时，子路径部署会去请求站点根，被网关默认站点用 `text/html` 兜底返回，字体加载
静默失败。`public/` 下的文件没有内容哈希，改了内容要确认它的 `Cache-Control` 不是长缓存，
否则老访客继续命中旧副本（当前只有字体二进制保留 30 天，CSS 与 `index.html` 为 `no-cache`）。

### 4. 备份

```bash
ssh ubuntu@<服务器> 'docker exec aiignite-cad-postgres pg_dump -U ai_ignite_cad -d ai_ignite_cad' \
  > cad-$(date +%Y%m%d).sql
```

含新迁移的发布务必先备份：迁移是单向的，里面若带数据清洗语句（例如建唯一索引前的去重 `DELETE`），
出错后没有自动回滚路径。建议把备份留在本地 `.backups/`（已被 `.gitignore` 与 `deploy-remote.sh` 的
rsync 排除，既不进仓库也不会上传到服务器）：

```bash
mkdir -p .backups
ssh ubuntu@<服务器> 'docker exec aiignite-cad-postgres pg_dump -U ai_ignite_cad -d ai_ignite_cad | gzip -6' \
  > .backups/cad-prod-$(date +%Y%m%d-%H%M).sql.gz
gzip -t .backups/cad-prod-*.sql.gz && echo OK
```

发布前还可以先用只读 SQL 预演迁移里的破坏性语句会影响多少行（例如统计
`GROUP BY project_id, element_id HAVING count(*) > 1` 的组数）；结果为 0 说明该迁移对现有数据无副作用。

`postgres_data` 是命名卷，删卷即删库；`down -v` 之前先确认已备份。

## 二、本机 Docker 试跑

```bash
cp .env.example .env          # 需要 GEMINI_API_KEY 时填本地值
docker compose up -d --build  # 前端 http://localhost:3220，后端 3225，Postgres 5432
```

注意本机的 5432 常被系统里的其它 Postgres 占用；占用时直接用现有实例跑 `backend/` 的开发流程即可，
不必强行起容器。

## 端口一览

| 端口 | 位置         | 用途                          |
| ---- | ------------ | ----------------------------- |
| 3220 | 生产宿主机   | 前端容器（仅 127.0.0.1）      |
| 3245 | 生产宿主机   | 后端容器（仅 127.0.0.1）      |
| 3220 | 本机开发     | Vite dev server / compose     |
| 3225 | 本机开发     | 后端 dev server / compose     |
| 5432 | 本机 compose | Postgres（生产容器不发布端口） |

## 环境变量

后端必需项与默认值见 [backend/.env.example](../../backend/.env.example)；生产编排用 `${VAR:?}` 硬校验，
缺 `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `JWT_SECRET` / `ENCRYPTION_KEY` / `FRONTEND_URL`
时直接拒绝启动，不会回退到默认密钥。

前端可配的构建参数只有两个：`VITE_BASE_PATH`（站点前缀）与 `VITE_API_URL`（接口前缀）。
**AI Key 不作为前端构建参数**：Vite 会把构建期变量内联进 JS，而产物由公网直接下发，
密钥只能留在后端容器环境里。

`FRONTEND_URL` 是 CORS 与 Socket.IO 的白名单，子路径部署时填域名根（`https://aiignite.com.cn`），
不要带 `/cad/`。

## 安全要点

- 后端位于两级 nginx 之后，`app.set("trust proxy", 2)` 让限流按真实客户端计数；
  去掉它会让所有访客共用一个桶，认证配额几分钟内被打满。
- SSE 端点 `/cad/api/llm/chat` 在 `deploy/nginx/cad.conf` 里单独关闭缓冲，其余接口保持缓冲以启用 gzip。
- CSP / HSTS 等安全头集中在 `backend/src/app.ts`，前端静态站的头在 `deploy/nginx/cad.conf`。
- 日志与错误信息不应出现 API Key、JWT 或完整请求体。
