#!/usr/bin/env bash
# 从本地工作区一键发布 AIIgniteCAD 到远程服务器（机制与 AIDriveAll / AIDriveNote 一致：
# rsync 工作区 → ssh 触发服务器侧 deploy.sh → 外部健康检查）。
#
# 与 AIDriveNote 的关键差别：本脚本不同步本地 .env。生产配置只存在于服务器仓库根目录的
# .env（由 scripts/init-server-env.sh 首次生成），密钥不进仓库，也不被开发机覆盖。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

CONFIG="${AIIGNITECAD_DEPLOY_CONFIG:-$ROOT/scripts/deploy.env}"
if [[ -f "$CONFIG" ]]; then
    # shellcheck source=/dev/null
    source "$CONFIG"
fi

HOST="${AIIGNITECAD_DEPLOY_HOST:?请设置 AIIGNITECAD_DEPLOY_HOST（见 scripts/deploy.env.example）}"
USER="${AIIGNITECAD_DEPLOY_USER:-ubuntu}"
REMOTE_PATH="${AIIGNITECAD_DEPLOY_PATH:-/home/ubuntu/AIIgniteCAD}"
DOMAIN="${AIIGNITECAD_DOMAIN:-aiignite.com.cn}"
CAD_SUBPATH="${CAD_SUBPATH:-/cad}"
FRONTEND_PORT="${AIIGNITECAD_FRONTEND_PORT:-3220}"

ssh_wrap() {
    if [[ -n "${AIIGNITECAD_SSH_PASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
        sshpass -p "$AIIGNITECAD_SSH_PASS" ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" "$@"
    else
        ssh -o StrictHostKeyChecking=no "${USER}@${HOST}" "$@"
    fi
}

rsync_ssh() {
    if [[ -n "${AIIGNITECAD_SSH_PASS:-}" ]] && command -v sshpass >/dev/null 2>&1; then
        echo "sshpass -p '$AIIGNITECAD_SSH_PASS' ssh -o StrictHostKeyChecking=no"
    else
        echo "ssh -o StrictHostKeyChecking=no"
    fi
}

echo "==> 目标: ${USER}@${HOST}:${REMOTE_PATH}"

echo "==> 同步代码..."
rsync -az \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.env' \
    --exclude 'scripts/deploy.env' \
    --exclude 'dist' \
    --exclude 'coverage' \
    --exclude '.backups' \
    --exclude 'playwright-report' \
    --exclude '.demo-frames' \
    --exclude '.test-results' \
    --exclude '.trae' \
    --exclude '*.log' \
    -e "$(rsync_ssh)" \
    ./ "${USER}@${HOST}:${REMOTE_PATH}/"

if [[ "${1:-}" == "--init-env" ]]; then
    echo "==> 首次初始化服务器生产配置..."
    ssh_wrap "cd ${REMOTE_PATH} && bash scripts/init-server-env.sh"
    echo "请把 AI Key 等补进 ${REMOTE_PATH}/.env，然后重新运行本脚本发布"
    exit 0
fi

if ! ssh_wrap "test -f ${REMOTE_PATH}/.env"; then
    echo "服务器上没有 ${REMOTE_PATH}/.env；先执行：bash scripts/deploy-remote.sh --init-env" >&2
    exit 1
fi

echo "==> 预检：宿主机 ${FRONTEND_PORT} 是否被其它项目的容器占用"
# ${CAD_SUBPATH}/ 槽位此前由另一个 CAD 项目使用；两个栈抢同一端口时，后启动的只会静默失败。
# 放在同步之后，首次 --init-env 只需要传代码、不需要端口已经空出来。
holders="$(ssh_wrap "docker ps --filter publish=${FRONTEND_PORT} --format '{{.Names}}' | grep -v '^aiignite-cad-' | tr '\n' ' '" || true)"
if [[ -n "${holders// /}" ]]; then
    echo "端口 ${FRONTEND_PORT} 已被占用：${holders}" >&2
    echo "先停掉它再发布（数据卷保留，可随时 up 回滚）：" >&2
    echo "  ssh ${USER}@${HOST} 'docker stop ${holders%% }'" >&2
    exit 1
fi

echo "==> 远程构建、迁移与自检..."
ssh_wrap "cd ${REMOTE_PATH} && chmod +x deploy.sh && ./deploy.sh"

echo "==> 外网健康检查..."
if curl -sf --connect-timeout 20 "https://${DOMAIN}${CAD_SUBPATH}/health"; then
    echo ""
else
    echo "警告: https://${DOMAIN}${CAD_SUBPATH}/health 不可达，请检查共享网关与安全组" >&2
fi
curl -s -o /dev/null -w "页面 HTTP %{http_code}，总耗时 %{time_total}s\n" \
    --connect-timeout 20 "https://${DOMAIN}${CAD_SUBPATH}/" || true

echo ""
echo "发布完成: https://${DOMAIN}${CAD_SUBPATH}/"
echo "日志: ssh ${USER}@${HOST} 'cd ${REMOTE_PATH} && docker compose -f docker-compose.prod.yml logs --tail=100 backend'"
