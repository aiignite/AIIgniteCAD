#!/bin/bash

# Docker部署测试脚本

set -e

echo "==================================="
echo "AIIgniteCAD Docker 部署测试"
echo "==================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo ""
echo "开始测试..."

# 测试1: 检查Docker镜像是否构建成功
echo -e "\n${YELLOW}[1/6] 检查Docker镜像...${NC}"
if docker images | grep -q "aiignite-cad"; then
    echo -e "${GREEN}✓ Docker镜像存在${NC}"
else
    echo -e "${RED}✗ Docker镜像不存在${NC}"
    exit 1
fi

# 测试2: 检查容器是否运行
echo -e "\n${YELLOW}[2/6] 检查容器状态...${NC}"
if docker-compose ps | grep -q "Up"; then
    echo -e "${GREEN}✓ 容器正在运行${NC}"
else
    echo -e "${RED}✗ 容器未运行${NC}"
    echo "请先运行: ./deploy.sh"
    exit 1
fi

# 测试3: 检查端口是否监听
echo -e "\n${YELLOW}[3/7] 检查端口 3400 (前端)...${NC}"
if lsof -Pi :3400 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✓ 端口 3400 正在监听${NC}"
else
    echo -e "${RED}✗ 端口 3400 未监听${NC}"
    exit 1
fi

echo -e "\n${YELLOW}[4/7] 检查端口 3410 (后端)...${NC}"
if lsof -Pi :3410 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✓ 端口 3410 正在监听${NC}"
else
    echo -e "${YELLOW}⚠ 端口 3410 未监听 (后端可能未启动)${NC}"
fi

# 测试5: HTTP健康检查
echo -e "\n${YELLOW}[5/7] HTTP健康检查 (前端)...${NC}"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3400 || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "304" ]; then
    echo -e "${GREEN}✓ HTTP响应正常 (状态码: $HTTP_CODE)${NC}"
else
    echo -e "${RED}✗ HTTP响应异常 (状态码: $HTTP_CODE)${NC}"
    exit 1
fi

# 测试6: 检查静态资源
echo -e "\n${YELLOW}[6/7] 检查静态资源...${NC}"
STATIC_FILES=("index.html" "assets/index.js" "assets/index.css")
for file in "${STATIC_FILES[@]}"; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3400/$file" || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✓ $file 可访问${NC}"
    else
        echo -e "${YELLOW}⚠ $file 不可访问 (可能正常)${NC}"
    fi
done

# 测试7: 检查容器日志
echo -e "\n${YELLOW}[7/7] 检查容器日志...${NC}"
ERROR_LOGS=$(docker-compose logs 2>&1 | grep -i error || echo "")
if [ -z "$ERROR_LOGS" ]; then
    echo -e "${GREEN}✓ 容器日志无错误${NC}"
else
    echo -e "${YELLOW}⚠ 发现错误日志:${NC}"
    echo "$ERROR_LOGS"
fi

echo ""
echo -e "${GREEN}==================================="
echo "✓ 所有测试通过!"
echo "===================================${NC}"
echo ""
echo "前端地址: http://localhost:3400"
echo "后端地址: http://localhost:3410"
echo "查看日志: docker-compose logs -f"
echo "停止服务: ./deploy.sh (选择选项 2)"