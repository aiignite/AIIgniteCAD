# 清理仓库历史中的密钥文件（.env）

本文是 **评审稿**，不是执行脚本。方案已在本地镜像克隆上完整预演（见「预演实测」），
但真正的强推是破坏性操作，需要你确认后再执行。

## 一、事件与范围

`AIIgniteCAD` 仓库为 **PUBLIC**，历史中曾提交过真实 `.env` 文件：

| 提交 | 日期 | 动作 | 文件 |
| --- | --- | --- | --- |
| `a24646e` | 2026-01-19 | 新增 | `.env` |
| `f08b719` | 2026-01-19 | 新增 | `backend/.env` |
| `1b98fbe` | 2026-10-23 | 删除 | `.env`、`backend/.env`（改为只留 `.env.example`） |

`HEAD` 已经干净（`1b98fbe` 之后仓库只跟踪 `.env.example`），**但历史没有被清除**——
任何人 `git log --all -- .env` 仍能取出旧内容。

已确认（只做相等性比对，未读取明文）：

- `JWT_SECRET`、`GEMINI_API_KEY`、`POSTGRES_PASSWORD` 的历史值与本地 `.env` **当前值完全相同**；
- `DATABASE_URL`、`FRONTEND_URL` 已与历史值不同。

**结论：密钥已在公网暴露，且仍在使用。清历史是收尾，轮换才是止损。**

## 二、预演实测（本地镜像克隆，未推送）

| 指标 | 重写前 | 重写后 |
| --- | --- | --- |
| 提交数 | 52 | 52（只剥路径，不改动提交本身） |
| 含 `.env` 的提交 | 3 | **0** |
| 仓库体积 | 12 M | 3.7 M（含 filter-repo 的 gc 回收） |
| 残留 env 文件 | `.env`、`backend/.env` | 仅 `.env.example`、`backend/.env.example` |
| `pre-push` 钩子复检 | 阻断 | **放行（exit 0）** |
| HEAD | `22e5923` | `6135021`（**所有 sha 都会变**） |

`git filter-repo` 会移除 `origin`，需要执行后重新添加（步骤 4 已包含）。

## 三、前置条件（缺一不可，顺序不能颠倒）

1. **密钥已轮换**——`GEMINI_API_KEY`、`JWT_SECRET`、`POSTGRES_PASSWORD` 先换掉（详见文末清单）。
   历史被 clone / fork 的副本无法收回，先清历史再轮换是本末倒置。
2. **选一个协作窗口**——重写后所有提交 sha 变化，协作者必须重新 clone，期间不能有人推送。
3. **通知协作者**——窗口内停止推送；清完各自 `git fetch --all && git reset --hard origin/main`
   或直接重新 clone。
4. **本机具备 `git-filter-repo`**（已验证可用：`/opt/homebrew/bin/git-filter-repo`）。

## 四、执行步骤

### 步骤 0：备份（不可跳过）

```bash
cd /Users/wyh/Documents/AIIgnite/AIIgniteCAD
mkdir -p .backups
# 全量 bundle：含所有 ref，可完整还原
git bundle create ".backups/AIIgniteCAD-full-$(date +%Y%m%d-%H%M).bundle" --all
git bundle verify ".backups/AIIgniteCAD-full-"*.bundle | tail -3
```

### 步骤 1：镜像克隆到临时目录

```bash
rm -rf /tmp/cad-purge
git clone --mirror /Users/wyh/Documents/AIIgnite/AIIgniteCAD /tmp/cad-purge
cd /tmp/cad-purge
```

### 步骤 2：重写历史

```bash
git filter-repo --path .env --path backend/.env --invert-paths --force
```

如果还发现密钥出现在别的文件里（不限于 `.env`），追加内容级清洗：

```bash
# /tmp/secret-patterns.txt，每行一条替换规则，形如 字面量==>***REMOVED***
printf 'ghp_xxxxxxxxxxxx==>***REMOVED***\n' > /tmp/secret-patterns.txt
git filter-repo --replace-text /tmp/secret-patterns.txt --force
```

### 步骤 3：校验（推之前必须先过）

```bash
cd /tmp/cad-purge
git rev-list --all --count                    # 应为 52
git rev-list --all -- .env backend/.env | wc -l   # 必须为 0
git log --all --name-only --format='' | grep -E '(^|/)\.env$' | head   # 应无输出
# 用仓库自带的钩子复检一遍（模拟推送）
echo "refs/heads/main $(git rev-parse HEAD) refs/heads/main $(git rev-parse HEAD)" \
  | bash /Users/wyh/Documents/AIIgnite/AIIgniteCAD/.githooks/pre-push && echo "钩子放行"
```

### 步骤 4：重新挂远端并强推

```bash
cd /tmp/cad-purge
git remote add origin git@github.com:aiignite/AIIgniteCAD.git   # 或 HTTPS + 凭据助手
git push --force --all origin
git push --force --tags origin
```

> 若仓库开了分支保护（禁止强推），先在 GitHub 上临时放开，推完再恢复。

### 步骤 5：GitHub 侧收尾

1. **检查 fork / 网络上的副本**（GitHub 仓库页 → Forks）。有 fork 就等于密钥还在别处，无法回收，
   更说明轮换必须做。
2. **清除 GitHub 的服务端缓存**：被强推覆盖的旧提交在 GitHub 上仍可通过旧 sha 直接访问一段时间，
   需要开 Support ticket 请求 purge cached views（这是官方建议流程）。
3. 检查 PR / Issue 里是否引用过旧提交 sha（引用会失效，通常可接受）。

### 步骤 6：本机仓库复位

`/tmp/cad-purge` 是重写后的权威副本，本机仓库按它对齐：

```bash
cd /Users/wyh/Documents/AIIgnite/AIIgniteCAD
git fetch --all
git reset --hard origin/main
git reflog expire --expire=now --all
git gc --prune=now --aggressive
```

或者干脆删掉本机克隆、从 GitHub 重新 clone（最干净，也最不容易留旧对象）。

### 步骤 7：确认钩子回到正常状态

历史干净后，`pre-push` 的全历史检测会自动放行，不再需要 `CAD_ALLOW_DIRTY_HISTORY=1`：

```bash
git push --dry-run
```

## 五、验收清单

- [ ] `GEMINI_API_KEY` 已撤销并重新签发，服务器 `.env` 与本地都已更新，线上 AI 功能正常
- [ ] `JWT_SECRET` 已轮换（现有登录态失效，已通知用户重新登录）
- [ ] `POSTGRES_PASSWORD` 已轮换，`DATABASE_URL` 已同步（本地与服务器）
- [ ] `ENCRYPTION_KEY` **未改动**（改动会导致库内 LLM Key 密文无法解密）
- [ ] `git rev-list --all -- .env backend/.env` 在远端克隆上返回 0
- [ ] 所有协作者已重新 clone 或硬复位
- [ ] `pre-push` 钩子在不设 `CAD_ALLOW_DIRTY_HISTORY` 时放行
- [ ] `.backups/` 中的 bundle 已留存并验证可用

## 六、回滚

```bash
# 从 bundle 还原整个仓库（在任何空目录执行）
git clone /path/to/AIIgniteCAD-full-YYYYMMDD-HHMM.bundle restored
# 或把旧 ref 强推回远端（仅在尚未通知协作者时可行）
cd restored && git push --force --mirror origin
```

## 七、风险与限制

- **已离开仓库的副本收不回来**：有人 clone / fork / 缓存过，旧密钥就永久存在。这正是必须先轮换的原因。
- **sha 全变**：协作者的本地分支、CI 缓存、指向旧提交的链接都会失效。
- **强推需要权限**：校验分支保护设置，必要时临时放开。
- **不要在清理前处理密钥**：先轮换，再清历史。
- **本次只处理 `.env` 路径**：若怀疑还有别处泄漏，先做一次全库内容扫描再决定是否加 `--replace-text`。

## 八、为什么 `pre-push` 现在会拦你

`pre-push` 已升级为**全历史检测**：只要待推送引用的历史里还有提交碰过密钥文件，推送就会被阻断。
在历史清理完成前，正常推送需要显式认领：

```bash
CAD_ALLOW_DIRTY_HISTORY=1 git push
```

这不是让你绕过检查，而是保证每次推送都清楚「历史里还有未处理的密钥」。
历史清干净之后，这个变量就再也不需要了。
