# Docker 更新部署指南

## 📋 概述

本指南说明如何将最新的前端代码更新部署到 Docker 容器中。

---

## 🚀 快速更新部署

### 方法一：使用部署脚本（推荐）

```bash
# 进入项目目录
cd AIIgniteCAD

# 运行部署脚本
./deploy.sh

# 选择选项 5: 清理并重新构建
```

### 方法二：手动命令

```bash
# 进入项目目录
cd AIIgniteCAD

# 停止现有容器
docker-compose down

# 重新构建并启动
docker-compose up -d --build

# 查看启动日志
docker-compose logs -f frontend
```

---

## 📦 完整部署流程

### 1. 准备工作

#### 检查 Docker 环境
```bash
# 检查 Docker 版本
docker --version

# 检查 Docker Compose 版本
docker-compose --version

# 确保 Docker 服务运行中
docker ps
```

#### 检查代码更新
```bash
# 查看 Git 状态
git status

# 拉取最新代码（如果使用 Git）
git pull origin main

# 或者确认新文件已存在
ls components/MarkdownMessage.tsx
```

### 2. 构建前端镜像

#### 仅构建前端
```bash
# 构建前端镜像
docker-compose build frontend

# 或者强制重新构建（不使用缓存）
docker-compose build --no-cache frontend
```

#### 查看构建日志
```bash
# 详细构建日志
docker-compose build --progress=plain frontend
```

### 3. 启动服务

#### 启动前端服务
```bash
# 启动前端容器
docker-compose up -d frontend

# 查看启动状态
docker-compose ps

# 查看实时日志
docker-compose logs -f frontend
```

#### 启动所有服务
```bash
# 启动所有服务（前端 + 后端 + 数据库）
docker-compose up -d

# 查看所有服务状态
docker-compose ps
```

### 4. 验证部署

#### 检查容器状态
```bash
# 查看运行中的容器
docker ps

# 应该看到：
# - aiignite-cad-frontend (端口 3400:80)
# - aiignite-cad-backend (端口 3410:3410)
# - aiignite-cad-postgres (端口 5435:5432)
```

#### 访问应用
```bash
# 前端访问地址
http://localhost:3400

# 后端 API 地址
http://localhost:3410/api
```

#### 检查健康状态
```bash
# 查看容器健康检查状态
docker-compose ps

# 查看详细日志
docker-compose logs frontend
docker-compose logs backend
```

---

## 🔧 常见操作

### 查看日志
```bash
# 查看前端日志
docker-compose logs frontend

# 实时查看日志
docker-compose logs -f frontend

# 查看最近 100 行日志
docker-compose logs --tail=100 frontend

# 查看所有服务日志
docker-compose logs
```

### 重启服务
```bash
# 重启前端服务
docker-compose restart frontend

# 重启所有服务
docker-compose restart

# 停止并重新启动
docker-compose down && docker-compose up -d
```

### 进入容器调试
```bash
# 进入前端容器
docker exec -it aiignite-cad-frontend sh

# 查看 nginx 配置
docker exec aiignite-cad-frontend cat /etc/nginx/conf.d/default.conf

# 查看前端文件
docker exec aiignite-cad-frontend ls -la /usr/share/nginx/html
```

### 清理资源
```bash
# 停止并删除容器
docker-compose down

# 删除容器和卷
docker-compose down -v

# 清理未使用的镜像
docker image prune -a

# 完全清理 Docker 系统
docker system prune -a --volumes
```

---

## 🎯 本次更新内容

### 新增文件
1. `components/MarkdownMessage.tsx` - Markdown 渲染组件
2. `CHAT_IMPROVEMENTS.md` - AI 对话框改进文档
3. `SLIDER_IMPROVEMENT.md` - 滑动条改进文档
4. 其他文档文件

### 修改文件
1. `components/RightPanel.tsx` - 增强 AI 助手功能
2. `index.css` - 添加滑块样式

### 验证更新
部署后验证以下功能：
- [ ] 属性面板滑动条正常工作
- [ ] AI 助手 Markdown 渲染正常
- [ ] 停止生成按钮功能正常
- [ ] 复制按钮功能正常
- [ ] 代码块高亮显示正常

---

## 🐛 故障排查

### 问题 1：构建失败
```bash
# 错误信息：npm install 失败

# 解决方案 1：清理缓存重新构建
docker-compose build --no-cache frontend

# 解决方案 2：检查网络连接
ping registry.npmmirror.com

# 解决方案 3：使用官方 npm 源
# 修改 Dockerfile，移除淘宝镜像配置
```

### 问题 2：容器启动失败
```bash
# 查看详细日志
docker-compose logs frontend

# 常见原因：
# 1. 端口被占用
sudo lsof -i :3400

# 2. 权限问题
sudo chown -R $USER:$USER .

# 3. 配置错误
docker-compose config
```

### 问题 3：无法访问前端
```bash
# 检查容器是否运行
docker ps | grep frontend

# 检查端口映射
docker port aiignite-cad-frontend

# 检查防火墙
sudo ufw status

# 测试容器内部
docker exec aiignite-cad-frontend wget -O- http://localhost
```

### 问题 4：更新未生效
```bash
# 原因：使用了缓存的镜像

# 解决方案：
# 1. 删除旧容器和镜像
docker-compose down
docker rmi aiignitecad-frontend

# 2. 强制重新构建
docker-compose build --no-cache frontend

# 3. 启动新容器
docker-compose up -d frontend
```

### 问题 5：新组件未包含
```bash
# 检查文件是否被 .dockerignore 排除
cat .dockerignore

# 验证文件在镜像中
docker run --rm aiignitecad-frontend ls -la /usr/share/nginx/html

# 如果文件缺失，检查构建步骤
docker-compose build --progress=plain frontend 2>&1 | grep "MarkdownMessage"
```

---

## 📊 性能优化

### 构建优化
```bash
# 使用多阶段构建（已实现）
# Dockerfile 已经使用了多阶段构建

# 使用 BuildKit 加速
DOCKER_BUILDKIT=1 docker-compose build frontend

# 并行构建多个服务
docker-compose build --parallel
```

### 镜像优化
```bash
# 查看镜像大小
docker images | grep aiignitecad

# 压缩镜像
docker save aiignitecad-frontend | gzip > frontend.tar.gz

# 清理构建缓存
docker builder prune
```

---

## 🔒 生产环境部署

### 环境变量配置
```bash
# 创建 .env 文件
cat > .env << EOF
NODE_ENV=production
VITE_API_URL=http://your-domain.com:3410
DATABASE_URL=postgresql://user:password@db:5432/aiignitecad
JWT_SECRET=your-secret-key
GEMINI_API_KEY=your-api-key
POSTGRES_USER=aiignite
POSTGRES_PASSWORD=strong-password
POSTGRES_DB=aiignitecad
EOF

# 设置安全权限
chmod 600 .env
```

### HTTPS 配置（推荐）
```bash
# 使用 Nginx Proxy Manager 或 Traefik
# 或者修改 nginx.conf 添加 SSL 配置

# 示例：使用 Let's Encrypt
# 1. 安装 certbot
# 2. 获取证书
# 3. 配置 nginx SSL
```

### 域名配置
```bash
# 更新 nginx.conf 中的 server_name
# 修改 docker-compose.yml 中的端口映射
# 配置 DNS 解析
```

---

## 📝 部署检查清单

### 部署前
- [ ] 代码已更新到最新版本
- [ ] 已执行 `npm run build` 本地测试
- [ ] Docker 和 Docker Compose 已安装
- [ ] 端口 3400, 3410, 5435 未被占用
- [ ] 环境变量已正确配置

### 部署中
- [ ] 构建成功无错误
- [ ] 容器启动成功
- [ ] 健康检查通过
- [ ] 日志无异常信息

### 部署后
- [ ] 前端页面可访问 (http://localhost:3400)
- [ ] 后端 API 可访问 (http://localhost:3410)
- [ ] 滑动条功能正常
- [ ] AI 助手 Markdown 渲染正常
- [ ] 停止生成功能正常
- [ ] 复制功能正常
- [ ] 深色/浅色主题切换正常

---

## 🚀 自动化部署

### 创建更新脚本
```bash
# 创建 update.sh
cat > update.sh << 'EOF'
#!/bin/bash
set -e

echo "开始更新 AIIgniteCAD..."

# 1. 拉取最新代码
echo "拉取最新代码..."
git pull origin main

# 2. 停止现有服务
echo "停止现有服务..."
docker-compose down

# 3. 重新构建前端
echo "重新构建前端..."
docker-compose build --no-cache frontend

# 4. 启动服务
echo "启动服务..."
docker-compose up -d

# 5. 等待服务启动
echo "等待服务启动..."
sleep 10

# 6. 检查状态
echo "检查服务状态..."
docker-compose ps

# 7. 显示日志
echo "显示前端日志（Ctrl+C 退出）:"
docker-compose logs -f frontend

EOF

chmod +x update.sh
```

### 使用自动化脚本
```bash
# 运行更新脚本
./update.sh
```

---

## 📞 支持与帮助

### 查看文档
- `DEPLOYMENT.md` - 完整部署文档
- `QUICKSTART.md` - 快速开始指南
- `CHAT_IMPROVEMENTS.md` - AI 对话框功能文档
- `SLIDER_IMPROVEMENT.md` - 滑动条功能文档

### 常用命令速查
```bash
# 快速重新部署
docker-compose up -d --build --force-recreate frontend

# 查看资源使用
docker stats

# 导出日志
docker-compose logs frontend > frontend.log

# 备份数据库
docker exec aiignite-cad-postgres pg_dump -U aiignite aiignitecad > backup.sql
```

---

## ✅ 完成确认

部署完成后，访问 http://localhost:3400 并验证：

1. ✅ 页面正常加载
2. ✅ 创建图形并使用滑动条调整属性
3. ✅ 打开 AI 助手发送消息
4. ✅ 验证 Markdown 渲染
5. ✅ 测试停止生成功能
6. ✅ 测试复制功能

全部通过后，部署成功！🎉

---

**最后更新**：2024年  
**版本**：v1.1.0