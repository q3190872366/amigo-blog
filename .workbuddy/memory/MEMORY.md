# amigo-blog 项目约定

## 协作规则
- 详见项目根目录 `agent.md`
- 核心原则：大白话沟通 / 需求确认95%+ / 调研先行避免造轮子 / 定计划再动手 / 拿不准就停

## 仓库
- GitHub: `q3190872366/amigo-blog`（Private），默认分支 `master`
- 部署目标：Cloudflare Pages（amigo-blog.pages.dev），production branch 标签 `main`（仅 Pages 侧，与仓库分支无关）
- CI：GitHub Actions（deploy.yml），push + workflow_dispatch 触发

## Git 推送（沙箱网络）
- 本沙箱 github.com:443 / api.github.com DNS（20.205.243.x）被墙或污染
- **SSH over 443**：~/.ssh/config 配置 Host github.com → ssh.github.com:443，deploy key 已配置
- **GitHub API**：可用 `--resolve api.github.com:443:140.82.121.5` 强制走旧 IP 段（通）
- Deploy key: `~/.ssh/id_ed25519` (workbuddy-cd-push)

## 分支规范
- 仓库唯一分支 `master`
- bot 写操作显式指定 `branch: 'master'`（不依赖默认分支）
- bot dispatch 目标分支 = `GITHUB_CLIENT_BRANCH` 环境变量��默认 `master`）
- Cloudflare Pages 8 个 secrets 不含 GITHUB_CLIENT_BRANCH（代码默认值生效）

## CDN 加速
- 字体 + 首页视频：jsDelivr `cdn.jsdelivr.net/gh/q3190872366/amigo-blog@master/themes/Amigo/static/...`
- CSS/JS/文章图片：Cloudflare Pages 本地
- 文章图片不接 jsDelivr（更新频繁，避免 7 天缓存/purge 问题）

## 部署
- 本地 Hugo: `E:/tools/hugo/hugo.exe`
- 本地 Wrangler: `E:/S2/npm-global/wrangler`
- 部署脚本: `scripts/deploy.sh`（需 CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID）
