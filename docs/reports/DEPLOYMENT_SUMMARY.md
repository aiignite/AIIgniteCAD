# AIIgniteCAD Docker 部署总结

## 部署状态

✅ **所有服务已成功部署并运行**

### 服务信息

| 服务 | 容器名称 | 端口映射 | 状态 |
|------|----------|----------|------|
| 前端 | aiignite-cad-frontend | 3400:80 | ✅ 运行中 |
| 后端 | aiignite-cad-backend | 3410:3410 | ✅ 运行中 |
| PostgreSQL | aiignite-cad-postgres | 5435:5432 | ✅ 运行中 |

### 访问地址

- **前端应用**: http://localhost:3400
- **后端API**: http://localhost:3410
- **健康检查**: http://localhost:3410/health
- **API信息**: http://localhost:3410/api
- **数据库**: localhost:5435

### 端口说明

- **前端 (3400)**: React生产应用，通过Nginx提供服务
- **后端 (3410)**: Express API服务器，支持WebSocket实时协作
- **数据库 (5435)**: PostgreSQL数据库（使用5435避免与其他项目冲突）

## 技术栈

### 前端
- React 19.2.3
- Vite 6.2.0
- Tailwind CSS
- TypeScript
- Nginx (生产服务器)

### 后端
- Node.js 20
- Express 4.18.2
- Prisma ORM 5.22.0
- PostgreSQL 15
- Socket.IO (实时协作)
- TypeScript

### 基础设施
- Docker & Docker Compose
- Alpine Linux (轻量级基础镜像)
- 国内npm镜像源 (https://registry.npmmirror.com)

## 配置文件

### 环境变量 (.env)
```env
DATABASE_URL=postgresql://aiignite:aiignite123@db:5432/aiignitecad
JWT_SECRET=your-secret-key-change-in-production-min-32-chars-long
GEMINI_API_KEY=your-gemini-api-key-here
POSTGRES_USER=aiignite
POSTGRES_PASSWORD=aiignite123
POSTGRES_DB=aiignitecad
```

### 网络配置
- Docker网络: aiignite-network (bridge模式)
- 服务间通信: 使用容器名称（如 `db`, `backend`, `frontend`）
- 数据卷: postgres_data (持久化数据库数据)

## 部署步骤

### 1. 快速部署
```bash
./deploy.sh
```
选择选项 `1) 构建并启动服务`

### 2. 手动部署
```bash
# 构建并启动所有服务
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

## 测试验证

### 运行测试脚本
```bash
./test-deployment.sh
```

### 手动测试

**前端测试**:
```bash
curl -I http://localhost:3400
```

**后端健康检查**:
```bash
curl http://localhost:3410/health
```

**后端API信息**:
```bash
curl http://localhost:3410/api
```

## 常用命令

### 服务管理
```bash
# 查看所有容器状态
docker-compose ps

# 查看实时日志
docker-compose logs -f

# 查看特定服务日志
docker-compose logs -f frontend
docker-compose logs -f backend
docker-compose logs -f db

# 重启服务
docker-compose restart

# 重启特定服务
docker-compose restart backend

# 停止服务
docker-compose down

# 停止并删除数据卷
docker-compose down -v

# 重新构建并启动
docker-compose up -d --build
```

### 进入容器
```bash
# 进入前端容器
docker exec -it aiignite-cad-frontend sh

# 进入后端容器
docker exec -it aiignite-cad-backend sh

# 进入数据库容器
docker exec -it aiignite-cad-postgres sh
```

### 数据库操作
```bash
# 连接到PostgreSQL
docker exec -it aiignite-cad-postgres psql -U aiignite -d aiignitecad

# 备份数据库
docker exec aiignite-cad-postgres pg_dump -U aiignite aiignitecad > backup.sql

# 恢复数据库
docker exec -i aiignite-cad-postgres psql -U aiignite aiignitecad < backup.sql
```

## Dockerfile 说明

### 前端 Dockerfile
- 多阶段构建 (Node构建 + Nginx服务)
- 使用淘宝npm镜像加速
- Nginx配置优化 (Gzip压缩、缓存、安全头)
- 静态资源哈希命名优化加载

### 后端 Dockerfile
- 基于Node.js 20 Alpine
- 安装OpenSSL 3支持Prisma
- 自动生成Prisma客户端
- TypeScript编译
- 启动时确保Prisma客户端已初始化

## 性能优化

### 已实现优化
1. **前端优化**:
   - Gzip压缩
   - 静态资源长期缓存 (1年)
   - 代码分割和哈希命名
   - Alpine Linux轻量级镜像

2. **后端优化**:
   - 连接池管理 (33个连接)
   - 压缩中间件
   - 请求日志记录
   - Helmet安全头

3. **数据库优化**:
   - Prisma查询优化
   - 连接池配置
   - 索引优化（待实现）

## 安全性配置

### 已实现
- Nginx安全头 (X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
- Helmet.js (Express安全中间件)
- CORS配置
- 健康检查端点
- 环境变量隔离

### 待完善
- HTTPS/SSL证书配置
- JWT密钥轮换
- API速率限制
- 输入验证和清理
- SQL注入防护（Prisma已提供）

## 故障排查

### 前端无法访问
```bash
# 检查容器状态
docker-compose ps frontend

# 查看前端日志
docker-compose logs frontend

# 检查端口占用
lsof -i :3400

# 重启前端
docker-compose restart frontend
```

### 后端无法启动
```bash
# 查看后端日志
docker-compose logs backend

# 检查数据库连接
docker-compose logs db

# 检查环境变量
docker exec aiignite-cad-backend env | grep DATABASE

# 重新生成Prisma客户端
docker-compose exec backend npx prisma generate
```

### 数据库连接失败
```bash
# 检查数据库容器状态
docker-compose ps db

# 查看数据库日志
docker-compose logs db

# 测试数据库连接
docker exec -it aiignite-cad-postgres psql -U aiignite -d aiignitecad
```

### 端口冲突
```bash
# 查看端口占用
lsof -i :3400
lsof -i :3410
lsof -i :5435

# 修改端口 (编辑docker-compose.yml)
# 然后重启服务
docker-compose up -d
```

## 更新部署

### 更新代码
```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 验证更新
./test-deployment.sh
```

### 更新依赖
```bash
# 清理并重新构建
docker-compose down
docker system prune -f
docker-compose up -d --build
```

## 生产环境部署建议

1. **环境配置**:
   - 使用生产环境变量
   - 设置强JWT密钥
   - 配置真实的GEMINI_API_KEY

2. **域名和SSL**:
   - 配置自定义域名
   - 启用HTTPS (Let's Encrypt)
   - 配置反向代理 (Nginx/HAProxy)

3. **监控和日志**:
   - 集成Prometheus监控
   - 配置Grafana仪表板
   - 设置日志收集 (ELK/Loki)
   - 配置告警通知

4. **备份策略**:
   - 定期数据库备份
   - 配置自动备份脚本
   - 备份到云存储

5. **扩展性**:
   - 使用Docker Swarm或Kubernetes
   - 配置负载均衡
   - 数据库读写分离
   - Redis缓存层

## 已知问题

### 前端静态资源
- 静态资源使用哈希命名（如 `index-D44wihtF.js`）
- 测试脚本检查 `assets/index.js` 会显示警告（正常现象）
- 实际文件存在但名称不同

### Prisma警告
- Alpine Linux下Prisma OpenSSL检测警告（不影响功能）
- 已安装OpenSSL 3确保兼容性

## 联系支持

如有问题，请查看：
- 项目文档: README.md
- 部署文档: DEPLOYMENT.md
- 日志文件: `docker-compose logs -f`

---

**部署时间**: 2026-01-19
**Docker版本**: 27.5.1
**Docker Compose版本**: v2.32.4
**部署状态**: ✅ 成功