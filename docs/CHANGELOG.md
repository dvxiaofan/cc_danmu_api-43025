# 变更记录

本文件只记录本 fork 的运维、部署和配置变更；上游代码说明以 `README.md` 为准。

## 2026-11-10

### 结果

| 项 | 当前值 |
|---|---|
| 线上地址 | `https://dm.ccucc.de5.net/<TOKEN>` |
| 线上版本 | `1.21.9` |
| 仓库版本 | `1.21.9` |
| 最近部署 | GitHub Actions `Fork Sync + Deploy` run `42788037976`，success |
| Redis | Upstash 已配置，`/api/config` 返回 `redisValid=true` |
| 管理接口 | 未配 `ADMIN_TOKEN`，返回 `401` 属预期 |
| 测试 | `npm test`：873/873 通过 |
| 构建 | `npx wrangler deploy --dry-run`：通过，0 errors |

### 代码与部署

- 全量同步上游 `huangxd-/danmu_api` 至 **v1.21.9**。
- 删除本 fork 的 `GET /api/v2/match` 补丁；该接口现在只保留上游的 `POST` 用法。
- 删除 `scripts/apply-local-patch.mjs`。旧脚本会把 `Response` 二次字符串化，导致 match 返回 `{}`，不要恢复。
- 重写 `.github/workflows/sync_fork.yml`：
  - 每天 02:23（北京）同步上游。
  - 只保护 `.github/workflows`、`docs/`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`。
  - 流程为 `npm install` → `npm test` → `wrangler deploy --dry-run` → 提交同步 → `wrangler deploy`。
  - 已移除 `continue-on-error`，失败会明确变红。
- GitHub Actions 部署使用仓库 Secret `CLOUDFLARE_API_TOKEN`；`CLOUDFLARE_ACCOUNT_ID` 由 workflow 默认值提供，
  当前没有额外仓库变量。
- 线上部署已验证为 v1.21.9；`/api/config` 同时返回 `hasAdminToken=false`。

### Upstash Redis

- 已在 Cloudflare Worker `danmu-api` 配置两个 Secret：
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- 两个值来自 Upstash 数据库的 **REST API** 页面；不是 `redis://` 连接串，也不是数据库密码。
- 配置后线上 `/api/config` 显示 `redisValid=true`。
- Secret 保存在 Cloudflare Worker 中，不在仓库和 GitHub Secrets 中；后续正常部署不会删除。
- 2026-11-10 曾临时使用 GitHub Actions 调用 Cloudflare API 写入 Secret。临时 workflow 和临时
  `TEMP_UPSTASH_*` GitHub Secrets 已在验证成功后删除；对应的提交为 `ea6cc1e`（临时流程）和
  `205ab6e`（清理），最终 main 不包含临时 workflow。

### 当前行为说明

- Redis 只持久化查询信息、episodeId→URL 映射和收藏；**不缓存弹幕正文**。弹幕正文仍由各视频源实时抓取。
- 若某集没有弹幕：先重试、换源，或用 `/api/v2/comment?url=<页面URL>` 直查；不要默认认为是 Redis 故障。
- 管理页面/管理接口现在返回 `401`，因为没有配置 `ADMIN_TOKEN`。这是主动选择，不影响播放器搜索和播放。
- `GET /api/v2/match` 已不存在；播放器使用搜索/手动匹配即可，`POST /api/v2/match` 仍可用。
- 由于线上接口需要 `TOKEN`，未带鉴权的请求返回 `401` 是正常现象，不代表服务不可用。

### 已知非阻塞问题

- 仓库自带的 `Build and Push Docker Image to Docker Hub` workflow 会因缺少 Docker Hub 密钥而失败
  （例如 run `42789367593`、`42789469199`）。本服务部署在 Cloudflare Workers，不使用 Docker 时可以忽略。
- `ADMIN_TOKEN` 仍未配置；如果以后确实需要管理页面，再单独配置，不要把它和普通 `TOKEN` 混用。

### 接手验证

```bash
cd /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025
npm test
npx wrangler deploy --dry-run

curl -s https://dm.ccucc.de5.net/api/config
# 期望：version=1.21.9，envs.redisValid=true
```

播放器的实际搜索/匹配还需要用户自己的 `TOKEN`；这是文档无法替代的最终验证。
