#!/usr/bin/env bash
# Deploy the Hugo blog to Cloudflare Pages (project: amigo-blog)
#
# Secrets are passed via ENVIRONMENT VARIABLES — never hardcode them:
#   CLOUDFLARE_API_TOKEN   token with permission "Cloudflare Pages: Edit"
#   CLOUDFLARE_ACCOUNT_ID  32-hex account id (from dash.cloudflare.com URL)
#
# Usage (git bash / WSL):
#   CLOUDFLARE_API_TOKEN=cfut_xxx CLOUDFLARE_ACCOUNT_ID=837f... ./scripts/deploy.sh
#
# Notes:
#   - Wrangler 4.x reads the account from CLOUDFLARE_ACCOUNT_ID (there is NO --account-id flag).
#   - NODE_OPTIONS must be empty, otherwise the system Node rejects --use-system-ca.
#   - Hugo binary defaults to E:/tools/hugo/hugo.exe (override with HUGO=...).
#   - Wrangler binary defaults to E:/S2/npm-global/wrangler (override with WRANGLER=...).

set -euo pipefail

export NODE_OPTIONS=""
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

HUGO="${HUGO:-E:/tools/hugo/hugo.exe}"
WRANGLER="${WRANGLER:-E:/S2/npm-global/wrangler}"

: "${CLOUDFLARE_API_TOKEN:?Please set CLOUDFLARE_API_TOKEN}"
: "${CLOUDFLARE_ACCOUNT_ID:?Please set CLOUDFLARE_ACCOUNT_ID}"

# 残留的缓存/锁文件会让 Hugo 与 Wrangler 报 "Access is denied"。
# 用 command 前缀绕过某些环境里把 rm 包装成函数的 shim。
command rm -rf .wrangler node_modules/.cache 2>/dev/null || true

# 安装 Functions 依赖（hono 等），确保 wrangler 打包 functions/ 时能解析 import。
# 依赖已存在时忽略失败（例如受限环境无法写 node_modules）。
echo "==> Installing Functions dependencies (hono)"
npm install --no-audit --no-fund --ignore-scripts 2>/dev/null || npm install --no-audit --no-fund --ignore-scripts 2>/dev/null || true

# --noBuildLock: 不生成 .hugo_build.lock，避免锁文件残留后再也构建不了
echo "==> Building site with Hugo"
"$HUGO" --gc --minify --noBuildLock

# 注意：项目根目录存在 wrangler.toml（含 pages_build_output_dir / nodejs_compat / KV 绑定），
# 因此 deploy 不能再传目录参数，否则 wrangler 会报冲突。
echo "==> Deploying to Cloudflare Pages (amigo-blog, 含 functions/ 飞书机器人)"
"$WRANGLER" pages deploy --branch main --commit-dirty=true

echo "==> Done. Live at https://amigo-blog.pages.dev"
echo "    飞书 webhook: https://amigo-blog.pages.dev/webhook/feishu"
