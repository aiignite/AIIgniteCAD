# Docker 部署指南

## 前置要求

- Docker 20.10+
- Docker Compose 2.0+

## 快速开始

### 1. 设置API密钥

创建 `.env` 文件并设置你的 Gemini API密钥：

```bash
cp .env.local .env
```

编辑 `.env` 文件，确保包含：
```
GEMINI_API_KEY=your_api_key_here
```

### 2. 构建并启动

使用部署脚本：

```bash
chmod +x deploy.sh test-deployment.sh
./deploy.sh
```

选择选项 `1) 构建并启动服务`

或使用Docker Compose命令：

```bash
docker-compose up -d --build
```

### 3. 测试部署

```bash
./test-deployment.sh
```

### 4. 访问应用

打开浏览器访问:
- 前端: `http://localhost:3400`
- 后端API: `http://localhost:3410`

## 常用命令

### 查看运行状态
```bash
docker-compose ps
```

### 查看日志
```bash
docker-compose logs -f
```

### 停止服务
```bash
docker-compose down
```

### 重启服务
```bash
docker-compose restart
```

### 清理并重新构建
```bash
docker-compose down
docker system prune -f
docker-compose up -d --build
```

### 进入容器
```bash
docker-compose exec aiignite-cad sh
```

## 目录结构

```
.
├── Dockerfile              # 前端Docker镜像定义
├── docker-compose.yml      # Docker Compose配置
├── nginx.conf             # Nginx生产配置
├── .dockerignore          # Docker构建忽略文件
├── deploy.sh              # 部署脚本
└── test-deployment.sh     # 测试脚本
```

## 端口配置

默认端口:
- 前端: `3400`
- 后端: `3410`
- 数据库: `5432`

如需修改端口，编辑 `docker-compose.yml`:

```yaml
services:
  frontend:
    ports:
      - "你的前端端口:80"
  backend:
    ports:
      - "你的后端端口:3000"
```

## 环境变量

在 `docker-compose.yml` 中添加环境变量:

```yaml
environment:
  - NODE_ENV=production
  - GEMINI_API_KEY=${GEMINI_API_KEY}
```

## 故障排查

### 端口被占用
```bash
lsof -i :3000
kill -9 <PID>
```

### 构建失败
```bash
# 清理Docker缓存
docker system prune -a
# 重新构建
docker-compose build --no-cache
```

### 容器无法启动
```bash
# 查看日志
docker-compose logs
# 检查配置
docker-compose config
```

## 性能优化

- 启用了Gzip压缩
- 静态资源缓存1年
- 使用多阶段构建减小镜像大小
- Alpine Linux基础镜像减小体积

## 安全性

- 禁止访问隐藏文件
- 添加了安全头(X-Frame-Options, X-Content-Type-Options, X-XSS-Protection)
- 最小权限原则
- 健康检查配置

## 生产部署建议

1. 使用反向代理(Nginx/HAProxy)
2. 配置HTTPS
3. 设置容器资源限制
4. 使用Docker Swarm或Kubernetes编排
5. 配置日志收集
6. 设置监控告警

## 更新部署

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build

# 验证更新
./test-deployment.sh
```