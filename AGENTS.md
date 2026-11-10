# AGENTS.md — 弹幕 API 服务（cc_danmu_api-43025）

> **2026-11-10 当前状态：已全量跟随上游 v1.21.9，并成功部署到线上。**
> `GET /api/v2/match` 补丁和整文件冻结已移除；`scripts/apply-local-patch.mjs` 已删除。
> 当前代码 build 通过、测试 873/873 通过；线上 `/api/config` 返回 `version=1.21.9`、`redisValid=true`。
> Upstash Redis 已配置；`ADMIN_TOKEN` 按需求仍未配置，管理接口返回 401 是预期行为。
> 本文档是当前操作入口；当天变更明细见 `docs/CHANGELOG.md`，`docs/FORK_NOTES.md` 是修复前的历史事故记录。

---

## 30 秒速览

| 项 | 值 |
|---|---|
| 这是什么 | 弹弹播放（DanDanPlay）协议兼容的弹幕 API，部署在 Cloudflare Workers |
| 上游 | `huangxd-/danmu_api`（AGPL-3.0） |
| 本 fork | `dvxiaofan/cc_danmu_api-43025`，伪 fork（整树覆盖同步） |
| 线上地址 | `https://dm.ccucc.de5.net/<TOKEN>`（`<TOKEN>` 是 URL 第一段的普通 token） |
| 线上版本 | v1.21.9（2026-11-10 部署并验证） |
| 仓库版本 | v1.21.9 |
| 最近部署 | GitHub Actions `Fork Sync + Deploy` run `42788037976`，success |
| 本地代码补丁 | **无**（GET /match 已放弃，手动搜弹幕即可） |
| 管理页面 | 未配 `ADMIN_TOKEN`；管理接口 401 是预期，日常不用可忽略 |
| Redis | Upstash 已配置；`/api/config` 的 `redisValid` 为 `true` |

## 同步策略

- GitHub Actions 每天 02:23（北京）从上游整树覆盖，然后安装依赖、跑测试、编译检查、部署。
- 只保护本 fork 的 `.github/workflows`、`docs/`、`AGENTS.md`、`CLAUDE.md`、`.gitignore`。
- `worker.js`、`dandan-api.js` 不再冻结，全部跟随上游。
- 改代码前先看 `docs/FORK_NOTES.md` 的历史事故记录，避免重新引入整文件冻结。

## 常用操作

```bash
cd /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025
npm install --registry=https://registry.npmmirror.com
npm test
npx wrangler deploy --dry-run
```

本地 Node 入口：

```bash
npm start          # 默认 9321 端口
```

## Upstash Redis

- 线上 Worker：`danmu-api`，两个 Secret 名称固定为：
  - `UPSTASH_REDIS_REST_URL`
  - `UPSTASH_REDIS_REST_TOKEN`
- 值来自 Upstash 数据库的 **REST API** 页面，不是 `redis://` 连接串或数据库密码。
- Secret 存在 Cloudflare Worker 中，不在仓库或 GitHub Secrets 里；重新部署不会删除。
- 配置入口：Cloudflare `Workers & Pages` → `danmu-api` → `Settings` → `Variables and Secrets`；
  或已登录 wrangler 时执行 `npx wrangler secret put <名称>`。
- 配置或轮换后验证：

```bash
curl -s https://dm.ccucc.de5.net/api/config
# 期望 envs.redisValid 为 true
```

## 当前限制

- **Redis 已配置，但它不缓存弹幕正文**：它持久化 episodeId→URL 映射和收藏；搜索与弹幕正文仍在实例内存/源站。若某集仍为空，先重试、换源，或用 `/api/v2/comment?url=<页面URL>` 直查，不要先怀疑 Redis。
- **没有 `ADMIN_TOKEN`（主动选择）**：`/api/env/set`、`/api/deploy`、`/api/cache/*`、`/api/logs/clear` 等管理接口会 401；日常播放不受影响。
- **`/api/env/set` 当前不可用**：线上 `DEPLOY_PLATFROM_*` 为空；改环境变量请用 Cloudflare Dashboard 或 `wrangler secret put`。
- **不要运行 `apply-local-patch.mjs`**：该脚本已删除；旧版本会把 GET /match 打成空响应。
- **没有 `GET /api/v2/match`**：上游只支持 POST；播放器里用搜索/手动匹配即可。
- **Docker 构建任务会红**：仓库自带 Docker Hub workflow 缺少密钥，与 Cloudflare 部署无关；不使用 Docker 可忽略。

## 关键坐标

```
线上     https://dm.ccucc.de5.net/<TOKEN>
Worker   danmu-api
上游     https://github.com/huangxd-/danmu_api
Fork     https://github.com/dvxiaofan/cc_danmu_api-43025
```

## 部署凭据与 workflow

- GitHub Actions 只使用仓库 Secret `CLOUDFLARE_API_TOKEN`（部署用，值不要写进文档）。
- `CLOUDFLARE_ACCOUNT_ID` 在 workflow 中有默认值，可用仓库变量覆盖；当前没有额外仓库变量。
- `sync_fork.yml` 是唯一负责 Cloudflare 部署的 workflow；`docker-image.yml` 的失败不影响本服务。

## 别犯的错

- ❌ 为了一个小补丁冻结整个 `worker.js` / `dandan-api.js`
- ❌ 改 `README.md` 加本地说明（每轮 sync 会被覆盖）
- ❌ 以为「CI 绿 = 部署成功」（已移除 `continue-on-error`，以后失败会红）
- ❌ 在 Cloudflare 配 `DEPLOY_PLATFROM_TOKEN` 之前不先配 `ADMIN_TOKEN`（会把管理接口写权限放大）
- ❌ 把管理页面当成日常播放必需项（不用就不配 ADMIN_TOKEN）
