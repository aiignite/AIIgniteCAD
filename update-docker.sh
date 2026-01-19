#!/bin/bash

# AIIgniteCAD Docker 一键更新部署脚本
# 用于快速更新前端代码到 Docker 容器

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 显示标题
echo -e "${BLUE}"
echo "============================================"
echo "  AIIgniteCAD Docker 一键更新部署"
echo "============================================"
echo -e "${NC}"

# 检查 Docker 是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: Docker 未安装${NC}"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查 Docker Compose 是否安装
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}错误: Docker Compose 未安装${NC}"
    echo "请先安装 Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# 检查是否在项目根目录
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}错误: 未找到 docker-compose.yml${NC}"
    echo "请在项目根目录运行此脚本"
    exit 1
fi

# 确认更新
echo -e "${YELLOW}此操作将：${NC}"
echo "  1. 停止现有的前端容器"
echo "  2. 重新构建前端镜像（包含最新代码）"
echo "  3. 启动新的前端容器"
echo ""
read -p "是否继续？(y/n): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}已取消更新${NC}"
    exit 0
fi

# 步骤 1: 停止前端容器
echo ""
echo -e "${BLUE}[1/6]${NC} 停止现有前端容器..."
docker-compose stop frontend
echo -e "${GREEN}✓ 前端容器已停止${NC}"

# 步骤 2: 删除旧容器
echo ""
echo -e "${BLUE}[2/6]${NC} 删除旧容器..."
docker-compose rm -f frontend
echo -e "${GREEN}✓ 旧容器已删除${NC}"

# 步骤 3: 删除旧镜像（可选）
echo ""
echo -e "${BLUE}[3/6]${NC} 删除旧镜像..."
if docker images | grep -q "aiignitecad.*frontend"; then
    docker rmi $(docker images | grep "aiignitecad.*frontend" | awk '{print $3}') 2>/dev/null || true
    echo -e "${GREEN}✓ 旧镜像已删除${NC}"
else
    echo -e "${YELLOW}未找到旧镜像，跳过${NC}"
fi

# 步骤 4: 构建新镜像
echo ""
echo -e "${BLUE}[4/6]${NC} 构建新的前端镜像..."
echo -e "${YELLOW}这可能需要几分钟时间，请耐心等待...${NC}"
docker-compose build --no-cache frontend

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 前端镜像构建成功${NC}"
else
    echo -e "${RED}✗ 镜像构建失败${NC}"
    echo "请查看上方错误信息并修复问题后重试"
    exit 1
fi

# 步骤 5: 启动新容器
echo ""
echo -e "${BLUE}[5/6]${NC} 启动新的前端容器..."
docker-compose up -d frontend

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ 前端容器启动成功${NC}"
else
    echo -e "${RED}✗ 容器启动失败${NC}"
    echo "请查看日志: docker-compose logs frontend"
    exit 1
fi

# 步骤 6: 验证部署
echo ""
echo -e "${BLUE}[6/6]${NC} 验证部署..."
sleep 3

# 检查容器状态
CONTAINER_STATUS=$(docker inspect -f '{{.State.Status}}' aiignite-cad-frontend 2>/dev/null || echo "not_found")

if [ "$CONTAINER_STATUS" = "running" ]; then
    echo -e "${GREEN}✓ 容器运行正常${NC}"
else
    echo -e "${RED}✗ 容器状态异常: $CONTAINER_STATUS${NC}"
    echo "请查看日志: docker-compose logs frontend"
    exit 1
fi

# 显示成功信息
echo ""
echo -e "${GREEN}"
echo "============================================"
echo "  🎉 更新部署完成！"
echo "============================================"
echo -e "${NC}"
echo ""
echo "访问地址: ${BLUE}http://localhost:3400${NC}"
echo ""
echo "验证更新内容："
echo "  ✓ 属性面板滑动条功能"
echo "  ✓ AI 助手 Markdown 渲染"
echo "  ✓ 停止生成按钮"
echo "  ✓ 复制功能"
echo ""
echo -e "${YELLOW}提示: 查看实时日志${NC}"
echo "  docker-compose logs -f frontend"
echo ""
echo -e "${YELLOW}提示: 查看所有服务状态${NC}"
echo "  docker-compose ps"
echo ""

# 询问是否查看日志
read -p "是否查看实时日志？(y/n): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${BLUE}显示前端日志 (按 Ctrl+C 退出)...${NC}"
    echo ""
    docker-compose logs -f frontend
fi
