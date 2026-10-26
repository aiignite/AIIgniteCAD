#!/usr/bin/env bash
#
# pre-push 钩子的自测：在临时目录里造出各种历史，验证钩子的判定。
#
# 为什么需要它：钩子的判定逻辑靠 pathspec + 文件名二次过滤，很容易写错。
# 首选版本就用 `.env.*` 的 pathspec 误拦了只含 `.env.example` 的干净仓库——
# 这类错误在真实仓库里跑一次是看不出来的（那里本来就脏，拦了也像是对的）。
#
# 用法：bash scripts/test-pre-push-hook.sh
#

set -uo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/.githooks/pre-push"
WORK="$(mktemp -d)"
ZERO="0000000000000000000000000000000000000000"
PASS=0
FAIL=0

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

if [ ! -x "$HOOK" ]; then
    echo "❌ 钩子不可执行：$HOOK" >&2
    exit 1
fi

# 造一个只含常规文件的基线仓库，返回最新提交 sha
make_repo() {
    local dir="$1"
    mkdir -p "$dir" && cd "$dir" || exit 1
    git init -q .
    git config user.email t@t.local
    git config user.name tester
    echo ok > a.txt
    git add a.txt
    git commit -qm base
}

# 断言：跑钩子并比对退出码
# 参数：$1 用例名 $2 期望退出码 $3 仓库目录 $4 stdin 内容（local_sha remote_sha） $5 可选环境变量
assert_hook() {
    local name="$1" expected="$2" repo="$3" payload="$4" envk="${5:-}"
    local actual
    if [ -n "$envk" ]; then
        actual=$(cd "$repo" && printf '%s\n' "$payload" | env "$envk" bash "$HOOK" >/dev/null 2>&1; echo $?)
    else
        actual=$(cd "$repo" && printf '%s\n' "$payload" | bash "$HOOK" >/dev/null 2>&1; echo $?)
    fi
    if [ "$actual" = "$expected" ]; then
        echo "  ✓ ${name} (exit=${actual})"
        PASS=$((PASS + 1))
    else
        echo "  ✗ ${name}: 期望 exit=${expected}，实际 exit=${actual}"
        FAIL=$((FAIL + 1))
    fi
}

echo "钩子自测: ${HOOK}"

# 用例 1：干净仓库（只有 .env.example）→ 放行
# 这条曾经失败：`.env.*` 的 pathspec 会命中 .env.example
make_repo "$WORK/clean"
echo "GEN=1" > .env.example
git add .env.example
git commit -qm "chore: only example env"
CLEAN_TIP=$(git rev-parse HEAD)
assert_hook "只含 .env.example 的仓库放行" 0 "$WORK/clean" \
    "refs/heads/main $CLEAN_TIP refs/heads/main $ZERO"

# 用例 2：历史里新增过 .env、但最新提交已删除 → 仅历史命中，阻断
# （真实仓库就是这个形态：当年提交过 .env，后来移除了，tip 干净）
make_repo "$WORK/history"
HIST_BASE=$(git rev-parse HEAD)
echo "SECRET=leak" > .env
git add -f .env
git commit -qm "feat: accidentally add .env"
git rm -q --cached .env
rm .env
echo "GEN=1" > .env.example
git add .env.example
git commit -qm "chore: drop .env, keep example"
HIST_TIP=$(git rev-parse HEAD)
assert_hook "历史含 .env 而 HEAD 干净时阻断" 1 "$WORK/history" \
    "refs/heads/main $HIST_TIP refs/heads/main $HIST_BASE"

# 用例 3：同上，但推送范围为空（远端已是最新）→ 只有全历史检查触发
assert_hook "范围为空时仍按历史阻断" 1 "$WORK/history" \
    "refs/heads/main $HIST_TIP refs/heads/main $HIST_TIP"

# 用例 4：同上 + 显式认领 → 放行（历史未清理期间的日常推送姿势）
assert_hook "认领后放行（CAD_ALLOW_DIRTY_HISTORY=1）" 0 "$WORK/history" \
    "refs/heads/main $HIST_TIP refs/heads/main $HIST_TIP" \
    "CAD_ALLOW_DIRTY_HISTORY=1"

# 用例 5：.env 就摆在最新提交的树里 → 硬阻断，认领也不放行
make_repo "$WORK/sneaky"
SNEAKY_BASE=$(git rev-parse HEAD)
echo "SECRET=leak" > .env
git add -f .env
git commit -qm "chore: add env"
SNEAKY_TIP=$(git rev-parse HEAD)
assert_hook "最新树含 .env 时阻断" 1 "$WORK/sneaky" \
    "refs/heads/main $SNEAKY_TIP refs/heads/main $SNEAKY_BASE"
assert_hook "认领也挡新增 .env" 1 "$WORK/sneaky" \
    "refs/heads/main $SNEAKY_TIP refs/heads/main $SNEAKY_BASE" \
    "CAD_ALLOW_DIRTY_HISTORY=1"

# 用例 6：删除远端分支的推送（local_sha 为全零）→ 放行
assert_hook "删除分支的推送放行" 0 "$WORK/history" \
    "refs/heads/main $ZERO refs/heads/main $HIST_TIP"

echo ""
if [ "$FAIL" -eq 0 ]; then
    echo "全部通过：$PASS 项"
    exit 0
fi
echo "失败 $FAIL 项（通过 $PASS 项）" >&2
exit 1
