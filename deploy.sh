#!/bin/bash

# AIIgniteCAD Docker 部署脚本

set -e

echo "==================================="
echo "AIIgniteCAD Docker 部署"
echo "==================================="

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# 检查Docker是否安装
if ! command -v docker &> /dev/null; then
    echo -e "${RED}错误: Docker 未安装${NC}"
    echo "请先安装 Docker: https://docs.docker.com/get-docker/"
    exit 1
fi

# 检查Docker Compose是否安装
if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}错误: Docker Compose 未安装${NC}"
    echo "请先安装 Docker Compose: https://docs.docker.com/compose/install/"
    exit 1
fi

# 显示菜单
echo ""
echo "请选择操作:"
echo "1) 构建并启动服务"
echo "2) 停止服务"
echo "3) 重启服务"
echo "4) 查看日志"
echo "5) 清理并重新构建"
echo "6) 查看运行状态"
echo "7) 退出"
echo ""
read -p "请输入选项 (1-7): " choice

case $choice in
    1)
        echo -e "${GREEN}开始构建并启动服务...${NC}"
        docker-compose up -d --build
        echo -e "${GREEN}✓ 服务启动成功!${NC}"
        echo "访问地址: http://localhost:3000"
        ;;
    2)
        echo -e "${YELLOW}停止服务...${NC}"
        docker-compose down
        echo -e "${GREEN}✓ 服务已停止${NC}"
        ;;
    3)
        echo -e "${YELLOW}重启服务...${NC}"
        docker-compose restart
        echo -e "${GREEN}✓ 服务已重启${NC}"
        ;;
    4)
        echo -e "${YELLOW}查看日志 (Ctrl+C 退出):${NC}"
        docker-compose logs -f
        ;;
    5)
        echo -e "${RED}清理并重新构建...${NC}"
        docker-compose down
        docker system prune -f
        docker-compose up -d --build
        echo -e "${GREEN}✓ 重新构建完成!${NC}"
        ;;
    6)
        echo -e "${YELLOW}服务运行状态:${NC}"
        docker-compose ps
        ;;
    7)
        echo "退出"
        exit 0
        ;;
    *)
        echo -e "${RED}无效选项${NC}"
        exit 1
        ;;
esac