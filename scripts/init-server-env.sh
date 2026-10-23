#!/usr/bin/env bash
# 首次发布时在服务器上生成生产配置：<仓库根>/.env（权限 600，不进仓库、不被 rsync 覆盖）
set -euo pipefail

cd "$(dirname "$0")/.."
ENV_FILE=".env"

if [[ -f "$ENV_FILE" ]]; then
    echo "已存在 $ENV_FILE，不做改动。需要调整请直接编辑该文件。"
    exit 0
fi

umask 077
cat >"$ENV_FILE" <<EOF
# AIIgniteCAD 生产配置（由 scripts/init-server-env.sh 生成）
# 本文件只留在服务器上；权限 600，绝不提交。

# 数据库容器
POSTGRES_USER=ai_ignite_cad
POSTGRES_PASSWORD=$(openssl rand -hex 16)
POSTGRES_DB=ai_ignite_cad

# JWT 签名密钥
JWT_SECRET=$(openssl rand -hex 32)

# 数据库中 LLM Key 的 AES-256-GCM 加密密钥
# 一旦用它加密过内容就不能再换，否则历史密文无法解密
ENCRYPTION_KEY=$(openssl rand -hex 32)

# 供后端 LLM 路由使用；留空则 AI 对话不可用，绘图/导入导出/版本历史不受影响
GEMINI_API_KEY=

# CORS 与 Socket.IO 白名单
FRONTEND_URL=https://aiignite.com.cn,https://www.aiignite.com.cn

# 网关槽位与前端构建参数
VITE_BASE_PATH=/cad/
VITE_API_URL=/cad/api
CAD_SUBPATH=/cad
FRONTEND_PORT=3220
BACKEND_PORT=3245

# /api/metrics 访问令牌；留空表示匿名可读
METRICS_TOKEN=$(openssl rand -hex 16)

LOG_LEVEL=info
EOF

chmod 600 "$ENV_FILE"
echo "已生成 $ENV_FILE（权限 600）。"
echo "下一步：把 GEMINI_API_KEY 填进去，再运行 bash deploy.sh 完成发布。"
