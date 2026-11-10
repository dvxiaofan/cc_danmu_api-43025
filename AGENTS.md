# AGENTS.md — 弹幕 API 服务（cc_danmu_api-43025）

> **给 AI / 接手的人的第一句话：这个仓库不是上游，是上游的「伪 fork」。**
> 动手前先读 `docs/FORK_NOTES.md`，否则你会踩到别人踩过的坑。

---

## 30 秒速览

| 项 | 值 |
|---|---|
| 这是什么 | 弹弹播放（DanDanPlay）协议兼容的弹幕 API，部署在 Cloudflare Workers |
| 上游 | `huangxd-/danmu_api`（AGPL-3.0） |
| 本 fork | `dvxiaofan/cc_danmu_api-43025`，**伪 fork** —— 见下方警告 |
| 线上地址 | `https://dm.ccucc.de5.net/<TOKEN>`（`<TOKEN>` 是 URL 第一段的鉴权 token） |
| 本地路径 | `/Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025` |
| 线上版本 | **v1.19.14**（2026-07-15 最后一次成功部署） |
| 仓库版本 | **v1.21.9**（跟上了上游，但**当前仓库状态编译不过**） |
| 本地独有功能 | 仅一处：`GET /api/v2/match?fileName=` |
| 协议许可 | AGPL-3.0（上游） |

---

## ⚠️ 最重要的一件事：这是「伪 fork」

**不要用 `git merge upstream/main`。** 合并不了，会冲突到没法看。

上游同步是**整树覆盖**（`git checkout upstream/main -- .`）+ 一个 exclude 清单。
这带来一条铁律：

> **任何你手动改的文件，只要不在 exclude 清单里，下次同步（每天 02:23 UTC）就会被静默冲掉。**

exclude 清单在 `.github/workflows/sync_fork.yml` 第 37-41 行，当前冻结 3 个文件：
`danmu_api/worker.js`、`danmu_api/apis/dandan-api.js`、`danmu_api/esm-shim.js`。

⚠️ 其中 **`esm-shim.js` 是死代码 exclude** —— 实际文件是 `esm-shim.**cjs**`（扩展名写错），
该 exclude 从未生效。别以为它被保护了。详见 `docs/FORK_NOTES.md`。

（`.github/workflows` 自己在清单里 = 自保护，不会被上游覆盖。）

**真实翻车案例**：2026-07-13 你已经修过一次 —— commit `3c6b497` 给 `wrangler.toml` 加了
`account_id`（修 CI 认证），但 `wrangler.toml` **不在** exclude 清单里 → 被次日 sync 冲掉 →
CI 从 2026-07-19 起重新开始挂。同理 GET/match 补丁也被冲掉过（`fe84aa3` 补回）——
exclude 机制就是为此诞生的，也是它现在弊端的源头。

**改同步策略时务必去掉整文件冻结** —— 为了保住 2 行的补丁而冻结整个文件，
代价是丢掉上游 4 个月新增的 11~13 个路由（口径见 `docs/FORK_NOTES.md` §4），还把 build 搞崩了。详见 `docs/FORK_NOTES.md` §5。

---

## 现在坏的 / 需要人管的

按严重度排序，完整版见 `docs/FORK_NOTES.md` §4：

1. **CI 部署挂了 4 个月** —— Wrangler 报 `Authentication error (code: 10000)`：
   `wrangler.toml` 缺 `account_id` → wrangler 去调 `/memberships` → token 没那个权限。
   且 deploy 步骤 `continue-on-error: true` **把失败染成绿的**，所以监控失效。
2. **仓库 build 失败** —— 冻结的 `dandan-api.js` import 了上游 2026-09-20 / 2026-11-01 已删除的
   `normalizeSpaces` / `resolveOffset`，ESM 静态导入期就炸。
3. **没配 Redis** —— `episodeId→url` 映射只在 Worker isolate 内存里，跨请求必丢 →
   `/api/v2/comment/<id>` 404 或空。
4. **管理接口无 admin 鉴权** —— 线上 `ADMIN_TOKEN` 为空，普通 TOKEN 能调 `/api/env/set`、
   甚至触发 `/api/deploy`。**上游 1.21.9 已修**（`ADMIN_ONLY_PATH_PATTERNS`），
   升级会自动锁上 —— 所以**升级前必须先配 `ADMIN_TOKEN`**，否则升级后管理界面直接 401。

---

## 动手前必做

```bash
cd /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025
git status && git remote -v          # 确认在 fork、知道工作区状态
npm install --registry=https://registry.npmmirror.com
npx wrangler deploy --dry-run        # 复现 build 状态（当前：失败）
```

- **先确认 `GET /api/v2/match` 补丁还有没有人用**（查 `/api/logs` 有无 GET 方式的 match 请求）。
  没人用 → 删掉补丁，全量跟随上游，exclude 清零，**永不再炸**。
- 要改代码，先看 `docs/FORK_NOTES.md` §5 的三方案对比，别自己发明第四个。

---

## 文档地图

| 文件 | 什么时候看 |
|---|---|
| **`docs/FORK_NOTES.md`** | **先看这个**（813 行）。fork 专属：本地补丁原理、8 个已知事故根因链、修复方案 A/B/C、v1.21.9 升级路径（含冒烟清单与回滚预案）、排查手册、接手清单 |
| `docs/INDEX.md` | 30 秒版本 + 文档索引 |
| `README.md` | **上游原文**（每轮 sync 覆盖）。只讲上游功能，**不包含本 fork 的任何特殊性** —— 别拿它当项目文档 |
| `scripts/apply-local-patch.mjs` | 幂等地重打 GET/match 补丁；锚点失配 exit 1（强制 CI 变红）。已实测 build 通过 |

---

## 关键坐标

```
线上     https://dm.ccucc.de5.net/<TOKEN>   (Worker secret: TOKEN)
Worker   danmu-api      Account <CF_ACCOUNT_ID>
Zone     <CF_ZONE_ID>   CNAME → <WORKER_SUBDOMAIN>.workers.dev
上游     https://github.com/huangxd-/danmu_api
Fork     https://github.com/dvxiaofan/cc_danmu_api-43025
```

## 别犯的错

- ❌ `git merge upstream/main` —— 伪 fork，合不了
- ❌ 在 exclude 清单外的文件上改代码 —— 下次 sync 就没了
- ❌ 以为「CI 绿 = 部署成功」 —— `continue-on-error` 会骗你
- ❌ 以为「build 失败 = 代码写错了」 —— 是同步策略冻结文件导致的
- ❌ 直接改 `README.md` 加说明 —— 每轮 sync 会被覆盖；说明放 `docs/`
- ❌ 以为 `/api/v2/comment/<id>` 空是 bug —— 优先查 Redis 有没有配（见 §4 事故 3）
