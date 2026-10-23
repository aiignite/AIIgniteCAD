#!/usr/bin/env bash
# 服务器侧发布脚本：构建并拉起生产栈、跑迁移、自检。
# 平时由 scripts/deploy-remote.sh 通过 ssh 调用，也可以在服务器上直接执行。
set -euo pipefail

cd "$(dirname "$0")"

FRONTEND_PORT="${FRONTEND_PORT:-3220}"
CAD_SUBPATH="${CAD_SUBPATH:-/cad}"
BACKEND_PORT="${BACKEND_PORT:-3245}"
COMPOSE="docker compose -f docker-compose.prod.yml"
# 4 GB 内存的共享机：前端 vite 与 LibreDWG 编译并行会触发 OOM，串行构建
export COMPOSE_PARALLEL_LIMIT="${COMPOSE_PARALLEL_LIMIT:-1}"

if ! docker compose version >/dev/null 2>&1; then
    echo "需要 Docker Compose v2（docker compose 子命令）" >&2
    exit 1
fi

if [ ! -f .env ]; then
    echo "缺少仓库根目录的 .env；首次发布请在服务器上执行 bash scripts/init-server-env.sh" >&2
    exit 1
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a

echo "[1/4] 构建并启动服务"
$COMPOSE up -d --build

echo "[2/4] 等待 PostgreSQL 就绪"
ready=no
for _ in $(seq 1 30); do
    if $COMPOSE exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
        ready=yes
        break
    fi
    sleep 2
done
if [ "$ready" != "yes" ]; then
    echo "PostgreSQL 未在 60 秒内就绪，中止发布" >&2
    $COMPOSE ps
    exit 1
fi

echo "[3/4] 应用 Prisma 迁移"
$COMPOSE run --rm --no-deps backend npx prisma migrate deploy

echo "[4/4] 自检"
backend_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${BACKEND_PORT}/ready")
health_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${FRONTEND_PORT}${CAD_SUBPATH}/health")
page_code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${FRONTEND_PORT}${CAD_SUBPATH}/")
echo "backend /ready=${backend_code} frontend ${CAD_SUBPATH}/health=${health_code} ${CAD_SUBPATH}/=${page_code}"
if [ "$backend_code" != "200" ] || [ "$health_code" != "200" ] || [ "$page_code" != "200" ]; then
    echo "自检未通过，查看日志：$COMPOSE logs --tail=100 backend" >&2
    $COMPOSE ps
    exit 1
fi

$COMPOSE ps
echo "发布完成：https://<域名>${CAD_SUBPATH}/"
