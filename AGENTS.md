# AGENTS.md — 弹幕 API 服务（cc_danmu_api-43025）

> **2026-11-10 当前状态：已按「方案 C」全量跟随上游 v1.21.9。**
> `GET /api/v2/match` 补丁和整文件冻结已移除；`scripts/apply-local-patch.mjs` 已删除。
> 当前代码 build 通过，测试 873/873 通过；CI 部署流程已改为「安装依赖 → 测试 → 编译检查 → 部署」。
> 本文档是当前操作入口；`docs/FORK_NOTES.md` 是修复前的历史事故记录，部分内容已过时。

---

## 30 秒速览

| 项 | 值 |
|---|---|
| 这是什么 | 弹弹播放（DanDanPlay）协议兼容的弹幕 API，部署在 Cloudflare Workers |
| 上游 | `huangxd-/danmu_api`（AGPL-3.0） |
| 本 fork | `dvxiaofan/cc_danmu_api-43025`，伪 fork（整树覆盖同步） |
| 线上地址 | `https://dm.ccucc.de5.net/<TOKEN>`（`<TOKEN>` 是 URL 第一段的普通 token） |
| 线上版本 | v1.19.14（截至 2026-11-10；本次修复待部署后变 v1.21.9） |
| 仓库版本 | v1.21.9 |
| 本地代码补丁 | **无**（GET /match 已放弃，手动搜弹幕即可） |
| 管理页面 | 未配 `ADMIN_TOKEN`；升级后管理接口会返回 401，日常不用可忽略 |
| Redis | 未配；按 episodeId 取弹幕可能偶发 404，需要时再配 Upstash |

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

## 当前限制

- **没有 Redis**：`/api/v2/comment/<episodeId>` 依赖 isolate 内存映射，跨 isolate 可能 404；优先用 `/api/v2/comment?url=<页面URL>` 或 Fongmi 直查接口。
- **没有 ADMIN_TOKEN**：升级后 `/api/env/set`、`/api/deploy`、`/api/cache/*`、`/api/logs/clear` 等管理接口会 401；日常播放不受影响。
- **`/api/env/set` 当前不可用**：线上 `DEPLOY_PLATFROM_*` 为空；改环境变量请用 Cloudflare Dashboard 或 `wrangler secret put`。
- **不要运行 `apply-local-patch.mjs`**：该脚本已删除；旧版本会把 GET /match 打成空响应。

## 关键坐标

```
线上     https://dm.ccucc.de5.net/<TOKEN>
Worker   danmu-api
上游     https://github.com/huangxd-/danmu_api
Fork     https://github.com/dvxiaofan/cc_danmu_api-43025
```

## 别犯的错

- ❌ 为了一个小补丁冻结整个 `worker.js` / `dandan-api.js`
- ❌ 改 `README.md` 加本地说明（每轮 sync 会被覆盖）
- ❌ 以为「CI 绿 = 部署成功」（已移除 `continue-on-error`，以后失败会红）
- ❌ 在 Cloudflare 配 `DEPLOY_PLATFROM_TOKEN` 之前不先配 `ADMIN_TOKEN`（会把管理接口写权限放大）
- ❌ 把管理页面当成日常播放必需项（不用就不配 ADMIN_TOKEN）
