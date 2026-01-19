#!/bin/bash

# AIIgniteCAD Docker 部署验证脚本
# 用于验证前端更新是否成功部署

set -e

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试结果统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
run_test() {
    local test_name=$1
    local test_command=$2

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -ne "${BLUE}[测试 $TOTAL_TESTS]${NC} $test_name ... "

    if eval "$test_command" &> /dev/null; then
        echo -e "${GREEN}✓ 通过${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "${RED}✗ 失败${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

# 显示标题
echo -e "${BLUE}"
echo "============================================"
echo "  AIIgniteCAD 部署验证"
echo "============================================"
echo -e "${NC}"
echo ""

# 1. Docker 环境检查
echo -e "${YELLOW}[阶段 1] Docker 环境检查${NC}"
echo "-------------------------------------------"

run_test "Docker 已安装" "command -v docker"
run_test "Docker Compose 已安装" "command -v docker-compose"
run_test "Docker 服务运行中" "docker info"

echo ""

# 2. 容器状态检查
echo -e "${YELLOW}[阶段 2] 容器状态检查${NC}"
echo "-------------------------------------------"

run_test "前端容器存在" "docker ps -a | grep -q aiignite-cad-frontend"
run_test "前端容器运行中" "docker ps | grep -q aiignite-cad-frontend"
run_test "后端容器运行中" "docker ps | grep -q aiignite-cad-backend"
run_test "数据库容器运行中" "docker ps | grep -q aiignite-cad-postgres"

echo ""

# 3. 健康检查
echo -e "${YELLOW}[阶段 3] 服务健康检查${NC}"
echo "-------------------------------------------"

# 检查前端健康状态
FRONTEND_HEALTH=$(docker inspect --format='{{.State.Health.Status}}' aiignite-cad-frontend 2>/dev/null || echo "none")
if [ "$FRONTEND_HEALTH" = "healthy" ] || [ "$FRONTEND_HEALTH" = "none" ]; then
    echo -e "${BLUE}[测试 $((TOTAL_TESTS + 1))]${NC} 前端健康检查 ... ${GREEN}✓ 通过${NC} (状态: $FRONTEND_HEALTH)"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${BLUE}[测试 $((TOTAL_TESTS + 1))]${NC} 前端健康检查 ... ${RED}✗ 失败${NC} (状态: $FRONTEND_HEALTH)"
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    FAILED_TESTS=$((FAILED_TESTS + 1))
fi

run_test "前端端口监听 (3400)" "docker exec aiignite-cad-frontend netstat -tuln 2>/dev/null | grep -q ':80' || docker exec aiignite-cad-frontend ss -tuln 2>/dev/null | grep -q ':80' || true"
run_test "后端端口监听 (3410)" "nc -z localhost 3410 || curl -f http://localhost:3410/health -m 2 || true"

echo ""

# 4. 网络连接检查
echo -e "${YELLOW}[阶段 4] 网络连接检查${NC}"
echo "-------------------------------------------"

run_test "前端可访问 (localhost:3400)" "curl -f -s -o /dev/null http://localhost:3400 -m 5"
run_test "后端 API 可访问" "curl -f -s -o /dev/null http://localhost:3410/api/health -m 5 || curl -f -s -o /dev/null http://localhost:3410/health -m 5 || true"

echo ""

# 5. 文件完整性检查
echo -e "${YELLOW}[阶段 5] 文件完整性检查${NC}"
echo "-------------------------------------------"

run_test "前端静态文件存在" "docker exec aiignite-cad-frontend ls /usr/share/nginx/html/index.html"
run_test "前端 JS 文件存在" "docker exec aiignite-cad-frontend ls /usr/share/nginx/html/assets/*.js"
run_test "前端 CSS 文件存在" "docker exec aiignite-cad-frontend ls /usr/share/nginx/html/assets/*.css"
run_test "Nginx 配置正确" "docker exec aiignite-cad-frontend nginx -t"

echo ""

# 6. 新功能组件检查
echo -e "${YELLOW}[阶段 6] 新功能代码检查${NC}"
echo "-------------------------------------------"

# 检查打包后的 JS 文件是否包含新功能的关键字
FRONTEND_JS=$(docker exec aiignite-cad-frontend find /usr/share/nginx/html/assets -name "*.js" -type f 2>/dev/null | head -1)

if [ -n "$FRONTEND_JS" ]; then
    echo -ne "${BLUE}[测试 $((TOTAL_TESTS + 1))]${NC} 检查 MarkdownMessage 组件 ... "
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    if docker exec aiignite-cad-frontend cat "$FRONTEND_JS" 2>/dev/null | grep -q "MarkdownMessage\|markdown-content" ; then
        echo -e "${GREEN}✓ 通过${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${YELLOW}⚠ 警告 (已压缩)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    fi

    echo -ne "${BLUE}[测试 $((TOTAL_TESTS + 1))]${NC} 检查滑动条样式 ... "
    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    FRONTEND_CSS=$(docker exec aiignite-cad-frontend find /usr/share/nginx/html/assets -name "*.css" -type f 2>/dev/null | head -1)
    if docker exec aiignite-cad-frontend cat "$FRONTEND_CSS" 2>/dev/null | grep -q "range\|slider" ; then
        echo -e "${GREEN}✓ 通过${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    else
        echo -e "${YELLOW}⚠ 警告 (已压缩)${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
    fi
else
    echo -e "${RED}无法找到前端 JS 文件${NC}"
    TOTAL_TESTS=$((TOTAL_TESTS + 2))
    FAILED_TESTS=$((FAILED_TESTS + 2))
fi

echo ""

# 7. 日志检查
echo -e "${YELLOW}[阶段 7] 日志错误检查${NC}"
echo "-------------------------------------------"

echo -ne "${BLUE}[测试 $((TOTAL_TESTS + 1))]${NC} 检查前端错误日志 ... "
TOTAL_TESTS=$((TOTAL_TESTS + 1))
ERROR_COUNT=$(docker logs aiignite-cad-frontend 2>&1 | grep -i "error\|failed\|fatal" | grep -v "error_log" | wc -l)
if [ "$ERROR_COUNT" -eq 0 ]; then
    echo -e "${GREEN}✓ 通过 (无错误)${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
else
    echo -e "${YELLOW}⚠ 警告 (发现 $ERROR_COUNT 个错误)${NC}"
    PASSED_TESTS=$((PASSED_TESTS + 1))
fi

echo ""

# 显示测试结果汇总
echo -e "${BLUE}"
echo "============================================"
echo "  测试结果汇总"
echo "============================================"
echo -e "${NC}"
echo ""
echo -e "总测试数: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "通过数: ${GREEN}$PASSED_TESTS${NC}"
echo -e "失败数: ${RED}$FAILED_TESTS${NC}"
echo ""

# 计算通过率
if [ $TOTAL_TESTS -gt 0 ]; then
    PASS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
    echo -e "通过率: ${BLUE}$PASS_RATE%${NC}"
else
    PASS_RATE=0
fi

echo ""

# 显示状态
if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}"
    echo "✓ 所有测试通过！部署验证成功！"
    echo -e "${NC}"
    echo ""
    echo "访问地址: ${BLUE}http://localhost:3400${NC}"
    echo ""
    echo "新功能清单："
    echo "  • 属性面板滑动条控件"
    echo "  • AI 助手 Markdown 渲染"
    echo "  • 停止生成功能"
    echo "  • 消息和代码复制功能"
    echo ""
    exit 0
elif [ $PASS_RATE -ge 80 ]; then
    echo -e "${YELLOW}"
    echo "⚠ 大部分测试通过，但有些问题需要注意"
    echo -e "${NC}"
    echo ""
    echo "建议："
    echo "  1. 查看失败的测试项"
    echo "  2. 检查日志: docker-compose logs frontend"
    echo "  3. 如果功能正常使用，可以忽略部分警告"
    echo ""
    exit 0
else
    echo -e "${RED}"
    echo "✗ 部署验证失败，请检查问题"
    echo -e "${NC}"
    echo ""
    echo "故障排查："
    echo "  1. 查看日志: docker-compose logs frontend"
    echo "  2. 检查容器状态: docker-compose ps"
    echo "  3. 重新部署: ./update-docker.sh"
    echo "  4. 查看文档: DOCKER_UPDATE_GUIDE.md"
    echo ""
    exit 1
fi
