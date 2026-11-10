# cc_danmu_api-43025 运维说明（历史记录）

> **2026-11-10 更新：本 fork 已按方案 C 全量跟随上游 v1.21.9。**
> GET /match 补丁、整文件冻结和 `scripts/apply-local-patch.mjs` 都已删除。
> 线上已部署 v1.21.9，Upstash Redis 已配置（`redisValid=true`），`ADMIN_TOKEN` 按需求未配置。
> 当前操作入口是 `AGENTS.md`；本文以下内容是修复前的历史记录，仅供复盘，部分命令和结论已过时。
> 当天变更明细和验证结果见 `docs/CHANGELOG.md`。

---

## 当前状态

| 项 | 值 |
|---|---|
| 线上版本 | v1.21.9（2026-11-10 部署并验证） |
| 仓库版本 | v1.21.9 |
| 本地代码补丁 | 无（GET /match 已放弃） |
| 验证状态 | build 通过；测试 873/873 通过 |
| CI 状态 | 已改为「安装依赖 → 测试 → 编译检查 → 部署」，失败会变红 |
| 管理页面 | 未配 ADMIN_TOKEN；管理接口 401 属预期，日常不用可忽略 |
| Redis | Upstash 已配置；`/api/config` 的 `redisValid` 为 `true` |

### 你现在需要知道的

1. 播放器日常使用：搜索、匹配、取弹幕；没有 GET /match，手动搜弹幕即可。
2. 不要运行 `scripts/apply-local-patch.mjs`（已删除）。
3. 改环境变量请用 Cloudflare Dashboard 或 `wrangler secret put`；线上 `DEPLOY_PLATFROM_*` 为空，`/api/env/set` 不可用。
4. 管理页面不用就不配 `ADMIN_TOKEN`；升级后它会自动锁成 401，不影响播放。
5. Redis 已配置；如果仍遇到某集没有弹幕，先重试、换源或按 URL 直查，不要重复注册 Upstash。

---

## 历史记录（修复前）

## 1. 血缘关系：什么是「伪 fork」

```
huangxd-/danmu_api  (上游，AGPL-3.0)
        │
        │  每天 02:23（北京）自动同步
        │  git checkout upstream/main -- .
        │  + exclude 保护 fork 文档、AI 约定和 workflow
        ▼
dvxiaofan/cc_danmu_api-43025  (本 fork，GitHub 上是 upstream 的 fork)
        │
        │  GitHub Actions → wrangler deploy
        ▼
Cloudflare Worker "danmu-api"
        │
        ▼
dm.ccucc.de5.net
```

**「伪 fork」的含义**：真正的 fork 会保留完整的 Git 历史（shared history），可以用 `git merge upstream/main` 正常合并。
本 fork 不是这样 —— 它是**把上游文件整树覆盖到自己的 main 分支**（`git checkout upstream/main -- .`），每次同步产生一个 `chore(sync): 同步上游 ...` 的空提交。

**exclude 清单在哪改**：`.github/workflows/sync_fork.yml`。2026-11-10 起只保护：

```bash
git checkout upstream/main -- . \
    ':(exclude).github/workflows' \
    ':(exclude)docs' \
    ':(exclude)AGENTS.md' \
    ':(exclude)CLAUDE.md' \
    ':(exclude).gitignore'
```

注意 `.github/workflows` **自己就在 exclude 清单里** —— 即 workflow 目录是自保护的，不会被上游覆盖。
所以 sync 策略的一切改动都落在这一个文件里。

> 历史记录：旧 exclude 曾整文件冻结 `worker.js`、`dandan-api.js`，并写过一条路径拼错的
> `danmu_api/esm-shim.js`（实际文件是 `.cjs`，从未生效）。这些冻结已在 2026-11-10 全部移除；
> 不要再把整文件冻结加回来。

**这带来两个后果，必须记住：**

1. **本 fork 的 main 和上游无法用 git merge 合并**，只能靠 exclude 清单做文件级保护。
2. **任何你手动改的文件，只要不在 exclude 清单里，下次同步就被静默冲掉**。
   真实案例：2026-07-13 的 `fe84aa3` commit 就是在补回被冲掉的 GET /match 补丁；
   2026-07-13 的 `3c6b497` 给 `wrangler.toml` 加的 `account_id` 也是这样被冲掉的 —— 见 §4 事故 1。

---

## 2. 本地独有功能：GET /api/v2/match

### 2.1 它是什么

**只有一个**本地改动，功能是：**让 match 接口同时支持 GET**。

上游的 `/api/v2/match` **只接受 POST**，内部无条件调 `await req.json()`（`danmu_api/apis/dandan-api.js` 的 `matchAnime`）。
但 SenPlayer 等播放器只发 GET，请求形如：

```
GET /api/v2/match?fileName=xxx.mkv
```

上游遇到这种请求会因为 `req.json()` 解析失败而报错。

### 2.2 实现方式（伪 req 注入）

补丁源头 commit `472d5e0`（2026-06-01），改动**只有两处**：

**`danmu_api/worker.js`** —— 加导入 + 加路由：

```js
// 导入行加一个 handleGetMatch
import { ..., matchAnime, handleGetMatch, ... } from "./apis/dandan-api.js";

// 路由层加一个 GET 分支（原本只有 POST）
if (path === "/api/v2/match" && method === "GET") {
  return handleGetMatch(url, clientIp);
}
```

**`danmu_api/apis/dandan-api.js`** —— 加一个 `handleGetMatch` 函数（约 32 行）：

```js
export async function handleGetMatch(url, clientIp) {
  const fileName = url.searchParams.get("fileName");
  // ... 参数校验 ...
  // 伪造一个带 json() 的 req，把 query 里的 fileName 喂给上游原生 matchAnime()
  const fakeReq = { json: async () => ({ fileName }), url: url.toString() };
  return await matchAnime(url, fakeReq, clientIp);
}
```

**为什么这个方案现在依然有效**：核对上游 1.21.9 的 `matchAnime` 函数体：
内部只用 `await req.json()` 取 body，**完全不再引用 `req.url`**（上游已重写整个匹配流程，改用
`parseFileName` / `extractTitleSeasonEpisode` 解析文件名）。
所以 fakeReq 方案不需要重写，只要提供 `json()` 即可。

> ⚠️ **但有一个必须注意的坑**：旧 fork 版的 `matchAnime` 有一行
> `let originSearchUrl = buildSearchAnimeUrl(req.url, title, season, episode);`
> —— 它依赖 `req.url` 构造搜索 URL。**上游 1.21.9 已删除这行。**
> 如果把补丁移植到上游版 `dandan-api.js` 上，`fakeReq` 里的 `url` 字段是**多余的**（不是错的，只是没用）。
> 但如果反过来把旧 fork 版 `matchAnime` 留着只换别的文件，`req.url` 就成了**必须正确提供**的字段 —— 否则搜索 URL 会构造失败。
> 这也是为什么 §5 强调「两个文件必须一起动」，不能只换一个。

### 2.3 改动面精确边界（已实测确认）

对比 fork 与上游基线 commit `0bcb0aac`：

| 文件 | 差异 |
|---|---|
| `danmu_api/worker.js` | 上游独有行 = 2（1 行 import + 1 行路由），fork 独有行 = 0 删改 |
| `danmu_api/apis/dandan-api.js` | 上游独有行 = **0**，fork 独有行 = 32（纯新增函数） |
| `danmu_api/esm-shim.js` | **路径写错的死代码 exclude** —— 实际文件是 `danmu_api/esm-shim.**cjs**`，**上游 main 也有同名文件**（不是 fork 独有）。这条 exclude 从未生效 |

**结论：本地改动极小，完全不需要「整文件冻结」。** 现在的 exclude 冻结了 3 个大文件，冻结粒度比补丁本身大两个数量级 —— 这就是 build 崩掉的直接原因。

### 2.4 上游至今没有这个功能

核对上游 main：`/api/v2/match` 只有 POST 分支，`matchAnime` 无条件 `req.json()`。
**所以这个补丁是真需求，不是冗余代码。**

> ⚠️ 但请先确认一件事：**SenPlayer / 弹弹play 这条 GET 路径现在还有人在用吗？**
> 如果没人用了，最省事、最不易再炸的方案是：删掉补丁，全量跟随上游，exclude 清零，仓库立刻恢复可编译且今后同步永不再炸。
> 如果还在用 → 必须走 §5 的修复方案。

---

## 3. 代码结构速览

```
danmu_api/
├── worker.js              # CF Worker 入口：路由分发 + 鉴权
├── server.js              # Node/Express 入口（本地开发用）
├── esm-shim.cjs           # Node 路径的 ESM 兼容垫片（CF 用不到）
├── apis/
│   ├── dandan-api.js      # ★ 弹幕核心：search/match/comment/bangumi/segmentcomment
│   ├── env-api.js         # ⚠️ 环境变量管理（set/add/del）—— 见 §6 安全
│   ├── system-api.js      # 部署、清理缓存等管理接口（有 adminToken 校验）
│   ├── favorite-api.js    # 收藏功能
│   ├── local-danmu-api.js # 本地弹幕（自建库）
│   └── clients/fongmi-api.js
├── sources/               # 26 个数据源
│   ├── base.js            # 数据源基类
│   ├── registry.js        # 数据源注册表
│   └── bilibili.js / youku.js / iqiyi.js / migu.js / dandan.js / douban.js / tmdb.js / local.js ...
├── utils/                 # 33 个工具模块
│   ├── cache-util.js      # ★ 内存/Redis 缓存 + episodeId 分配
│   ├── common-util.js     # 通用函数
│   ├── offset-util.js     # 弹幕 offset 换算
│   ├── local-danmu-parser.js / local-danmu-store.js
│   ├── redis-util.js / local-redis-util.js
│   └── ...
├── configs/
│   ├── globals.js         # 全局状态 + 环境变量读取
│   ├── handlers/          # 平台适配（cloudflare-handler.js / node-handler.js / ...）
│   └── ...
├── models/dandan-model.js
├── ui/                    # 前端管理界面
└── tests/                 # node:test 单元测试
```

**部署形态**：同一份代码，`configs/handlers/` 下按平台分支。CF 走 `cloudflare-handler.js`（可直接调 CF API 改环境变量），Node/Docker 走 Node 版。

**多平台支持**：上游同时支持 CF Workers / Vercel / Netlify / EdgeOne / Docker / Node。本 fork 只用了 CF。

---

## 4. 当前已知问题（按严重度排序）

### 事故 1：CI 部署从 2026-07-19 起全线失败 🔴

**现象**：GitHub Actions 每天跑 `sync + deploy`，deploy 步骤报
`Authentication error (code: 10000)`，但 **workflow 显示绿色**。

**根因（两层）**：

**① 修复被 sync 冲掉了。**
2026-07-13 的 commit `3c6b497` 已经给 `wrangler.toml` 加过一行：

```toml
account_id = "<CF_ACCOUNT_ID>"
```

wrangler 有了 `account_id` 就不必调 `/memberships` 接口（那个接口要 `User Details:Read` 权限，而 token 没有）。
**但 `wrangler.toml` 不在 exclude 清单里** → 2026-07-14 的 sync 把它整树覆盖回上游版本 → `account_id` 消失 → CI 重新开始撞 10000。

**② `continue-on-error: true` 掩盖了失败。**
workflow 里 deploy 步骤带 `continue-on-error: true`，所以即使部署失败，CI 也是绿的。**监控完全失效** —— 老大是人工才发现线上 4 个月没更新。

**故障期状态（已结束）**：线上曾停留在 **v1.19.14**（2026-07-15 最后一次成功部署），仓库代码已到 v1.21.9。
最近失败的 run：2026-07-19、2026-07-22 等。

**后续状态（2026-11-10）**：已恢复自动部署，线上 v1.21.9；`continue-on-error` 已移除，
account ID 改为在 workflow 环境变量中提供，不再依赖会被 sync 覆盖的 `wrangler.toml`。

**当时的修复思路**：
- 让 deploy 稳定拿到 account ID（最终做法：在 workflow 里设置 `CLOUDFLARE_ACCOUNT_ID`，不依赖 `wrangler.toml`）
- 删掉 deploy 步骤的 `continue-on-error: true`（已删除）
- 顺带：token 若有 `User Details:Read` 则更稳，但**加了 `account_id` 就够用了**，不必换 token

**具体改哪几行**（`.github/workflows/sync_fork.yml`）：

| 行号 | 现状 | 改成 |
|---|---|---|
| 37-41 | exclude 清单只有 4 项 | 加 `':(exclude)wrangler.toml'` 和 `':(exclude)docs'` `':(exclude)scripts'` |
| 55-63 | `DEBUG token fingerprint (TEMP - will revert)` 步骤 | **整步删掉**（它每天把 token 指纹打进公开日志） |
| 70 | `continue-on-error: true` | **删掉这行**（否则部署失败 CI 还是绿的） |

`wrangler.toml` 里补回被 sync 冲掉的那行：

```toml
name = "danmu-api"
account_id = "<CF_ACCOUNT_ID>"   # ← 这行，缺了 wrangler 就去调 /memberships 撞 10000
main = "danmu_api/worker.js"
```

### 事故 2：仓库当前 build 失败 🔴

**现象**：在干净 main 分支上跑 `npx wrangler deploy --dry-run`：

```
No matching export in "danmu_api/utils/common-util.js" for import "normalizeSpaces"
No matching export in "danmu_api/utils/offset-util.js" for import "resolveOffset"
```

**exclude 清单全名单（改同步策略前必须知道，共 3 个文件被冻结）**：

| 被冻结的文件 | 冻结影响 |
|---|---|
| `danmu_api/worker.js` | 路由层冻结 → 缺 11~13 个上游路由 + 缺 admin 校验（事故 5） |
| `danmu_api/apis/dandan-api.js` | import 已删除的导出 → **build 直接失败**（本事故） |
| `danmu_api/esm-shim.js` | **无效 exclude**（实际是 `.cjs`，路径写错；上游 main 也有该文件）→ 实际效果为零 |

**根因**：sync 的 exclude 清单**整文件冻结**了 `danmu_api/apis/dandan-api.js`（停在 2026-07-13），
但上游在 2026-09-20（commit `280b2327`）删了 `common-util.js` 的 `normalizeSpaces`，
2026-11-01（commit `cad83795`）删了 `offset-util.js` 的 `resolveOffset`。
而 `common-util.js` / `offset-util.js` **不在 exclude 里**，正常跟着上游更新了。
→ 冻结的 `dandan-api.js` import 了两个已被删除的导出 → **ESM 静态导入期就炸**。

**注意**：ESM 的静态导入是**编译期**解析，不是运行期。所以这不是「调用时才报错」，是整个 Worker 打不起来。

**已验证的修复路径**：
- 把 `dandan-api.js` 换成上游版本 + 把 `handleGetMatch` 移植回去 → build 通过（Total Upload 4974.55 KiB）
- ⚠️ **两个文件必须一起动**：只换 `dandan-api.js` 会报 `No matching export for import "handleGetMatch"`（`worker.js` 在 import 它）

### 事故 2b：冻结的 worker.js 缺少上游 1.20+ 的 11 个路由 🟠

**现象**：线上 `/api/v2/favorite/*` 全部 404。

**根因**：sync 的 exclude 清单冻结了整个 `danmu_api/worker.js`（停在 2026-07-13）。
上游 1.20 之后在 worker.js 里新增了一批路由，冻结版里**一个都没有**：

```
/api/v2/favorite/add        /api/v2/favorite/list      /api/v2/favorite/refresh
/api/v2/favorite/remove     /api/v2/favorite/schedule
/api/favorite/add           /api/favorite/list         /api/favorite/refresh
/api/favorite/remove        /api/favorite/schedule
/api/auto-match-mapping/refresh
/api/title-mapping/refresh
/api/nipaplay/verify
```

**统计口径有两种，两个都要知道**（否则一数就对不上）：

| 口径 | upstream | fork | 差 |
|---|---|---|---|
| 全部 `path === "..."` 字面量去重（含 `/`、`/favicon.ico`、`/robots.txt`） | **35** | **24** | **11** |
| 排除 3 个静态资源后的 API 路由 | **32** | **21** | **13** |

差的那 13 个（API 口径）就是上面列的：favorite ×10 + auto-match-mapping + title-mapping + nipaplay。
另有 2 个是 fork 独有（上游已改名/重构）：`/api/v2/fongmi/danmaku`、`/danmaku`。

> 核对命令（自己数一遍，别信文档）：
> ```bash
> grep -oE 'path(\.startsWith)? *=== *"[^"]+"' danmu_api/worker.js | sed 's/.*"\(.*\)"/\1/' | sort -u | wc -l
> ```

**这是「整文件冻结」代价的直接证据** —— 为了保住 2 行的 GET/match 补丁，
代价是丢掉上游 4 个月新增的全部 11 个路由 + 后续所有 worker.js 改动。

**修好 build（方案 A/B）后这条自动解决**：worker.js 跟随上游更新，补丁以 re-apply 方式打回去。

### 事故 3：没配 Redis → 弹幕接口拿不到数据 🟠

> **后续状态（2026-11-10）：已配置 Upstash，线上 `redisValid=true`。以下保留为故障复盘。**

**现象**：
```
GET /api/v2/comment/10002      → HTTP 404, comments: []
GET /api/v2/comment?url=...     → HTTP 200, success:true, count:0   ← 注意：成功但空
```

**根因**：`/api/v2/comment/<episodeId>` 的实现链是：

```
episodeId → findUrlById(id) → globals.episodeIds 查表 → 拿到 url → 再去各源抓弹幕
```

`globals.episodeIds` 是**内存态**。这个映射是在 `match` / `search` 流程里由 `addAnime()` 建立的
（`danmu_api/utils/cache-util.js:580`），**只存在于当前 Worker isolate 的内存里**。

Cloudflare Workers 无状态：下一个请求很可能落到**另一个 isolate**，映射就没了 → 查不到 url → 404。
而且 `globals.animes` 也是内存态，`/api/cache/animes` 返回 `{"success":true,"data":[]}` 印证了这一点。

**上游 README 也提到这个**（issue #33「小幻使用时掉匹配无法加载弹幕」），解法同样是配 Redis。

**但要注意 Redis 的能力边界**（上游 README 原文）：
> 配置 redis 可持久化原有查询信息和永久收藏；**搜索结果与弹幕缓存仍只保存在实例内存中，不会写入 Redis**

所以 Redis 能解决的是「**id→url 映射和收藏的持久化**」，让 match 出来的 episodeId 在后续请求里还能查到；
**弹幕正文本身仍然要实时去各视频源抓**。

**待确认**：本地 CF token 有 `Workers Scripts:Edit`，**有没有 Upstash Redis 的配置能力**（需要在 CF 上配 Upstash 或自建 Redis）。
如果不能配 Redis，还有一条路：改用 `/api/v2/comment?url=<真实视频页URL>` 这种**不依赖 id→url 映射**的直查方式（实测该接口返回 200 但 count=0，需要进一步查是源站没弹幕还是 URL 不对）。

### 事故 4：DEBUG token 指纹泄漏到公开日志 🟠

workflow 里有一步名为 `DEBUG token fingerprint (TEMP - will revert)`，
**每天把 token 的指纹信息打进公开的 Actions 日志**。

这是个临时排查步骤，忘了删。**注意**：已提交到 git 的内容 `git checkout` 撤不回，必须靠新 commit 删掉。

### 事故 5：管理端点无鉴权（线上 v1.19.14）🔴 —— 升级到 v1.21.9 会自动修复

> **后续状态（2026-11-10）：已升级 v1.21.9，管理接口现在返回 401；`ADMIN_TOKEN` 仍未配置。**
> 以下为 v1.19.14 裸奔时的复盘记录。

**故障时实测（v1.19.14）**：

```
ADMIN_TOKEN = ''          ← /api/config 实测，未配置
redisValid = False        ← 故障时未配 Redis（印证事故 3；现已配置）
```

用**普通 TOKEN**（非 admin）调用线上管理接口：

```
POST /api/env/set   → HTTP 500 {"success":false,"message":"环境变量 ... 设置失败"}
                       ↑ 注意：不是 401，是"进到业务逻辑后才失败" → 鉴权确实缺失
POST /api/deploy    → HTTP 200 {"success":true,"message":"Deployment triggered successfully"}
                       ↑ 连部署都能被普通 TOKEN 触发
```

**根因**：冻结的 `danmu_api/worker.js`（2026-07-13）**没有路由层 admin 校验**。
`env-api.js` 自身也无 token 检查；路由层只校验「URL 第一段 == TOKEN 或 == ADMIN_TOKEN」，
ADMIN_TOKEN 为空时该条件对普通 TOKEN 恒真。

**⚠️ 重要：这个问题上游已经修了，本 fork 落后导致仍在裸奔。**

上游 main 在 `worker.js` 路由层加了 `ADMIN_ONLY_PATH_PATTERNS` 强制校验：

> **怎么自己复核这条结论**（因为本仓库的 `worker.js` 被冻结，upstream 代码不在本地，
> 光看这个目录**证实不了**「上游已修」）：
>
> ```bash
> # 直接看上游当前的 worker.js 里有没有这个常量
> gh api repos/huangxd-/danmu_api/contents/danmu_api/worker.js?ref=main --jq '.content' \
>   | base64 -d | grep -n "ADMIN_ONLY_PATH_PATTERNS"
> ```
>
> 有输出 = 上游确实已加（当前实测有，见 §6.9 的复核记录）；无输出 = 上游没加，别信本文档。
>
> 也可以本地比对（把上游 worker.js 拉下来跟冻结版 diff）：
>
> ```bash
> git fetch upstream && git diff upstream/main -- danmu_api/worker.js | head -80

>
> **上游的实际校验逻辑**（`worker.js` 第 52-62 行定义，第 305 行执行）——
> 受保护的管理接口共 9 组：
>
> ```js
> const ADMIN_ONLY_PATH_PATTERNS = [
>   /^\/api\/env\/(?:set|add|del)\/?$/,
>   /^\/api\/deploy\/?$/,
>   /^\/api\/cache\/(?:clear|animes)\/?$/,
>   /^\/api\/logs\/clear\/?$/,
>   /^\/api\/cookie\/(?:status|save|verify|qr\/generate|qr\/check)\/?$/,
>   /^\/api\/ai\/verify\/?$/,
>   /^\/api\/nipaplay\/verify\/?$/,
>   /^\/api\/title-mapping\/refresh\/?$/,
>   /^\/api\/auto-match-mapping\/refresh\/?$/,
> ];
> ```
>
> 注意覆盖了 `/api/cache/animes`、`/api/logs/clear`、`/api/cookie/*` 等 ——
> **当前线上这些全是无鉴权可调的**，不只是 `/api/env/set` 和 `/api/deploy`。
> ```

```js
const ADMIN_ONLY_PATH_PATTERNS = [
  /^\/api\/env\/(?:set|add|del)\/?$/,
  /^\/api\/deploy\/?$/,
  /^\/api\/cache\/(?:clear|animes)\/?$/,
  /^\/api\/logs\/clear\/?$/,
  /^\/api\/cookie\/(?:status|save|verify|qr\/generate|qr\/check)\/?$/,
  /^\/api\/ai\/verify\/?$/,
  /^\/api\/nipaplay\/verify\/?$/,
  /^\/api\/title-mapping\/refresh\/?$/,
  /^\/api\/auto-match-mapping\/refresh\/?$/,
];
// 路由层判定：必须是显式携带 ADMIN_TOKEN 才放行，否则 401
const isAdminRequest = Boolean(globals.adminToken) && explicitToken === globals.adminToken;
```

上游 README 也已写明：
> 「系统管理接口……在服务端强制要求 `ADMIN_TOKEN`：**未配置时这些接口一律返回 `401`**」

**所以：升级到 v1.21.9 后行为会变 —— 管理接口从「TOKEN 可写」变成「未配 ADMIN_TOKEN 则 401」。**
这是好事（漏洞自动修复），但**必须提前知道**，否则升级后管理界面会突然打不开。
→ **升级前先配置 `ADMIN_TOKEN`**（见 §6.5）。

**关于 `<TOKEN>`**：它出现在 URL 里 → 会进日志、会进截图、会进播放器配置 —— 视为**已泄露**。
另外实测 `/api/config` 在**带 TOKEN** 访问时会返回 `originalEnvVars.TOKEN` 的**明文**
（不带 token 访问则是打码的 `**************`）。建议轮换。

### 事故 5b：`/api/config` 泄露内部拓扑 🟡

未鉴权即可访问，返回全部环境变量**键名 + 当前值**（敏感值打码，但结构、是否配置、
`redisValid`/`aiValid` 等运行状态全暴露）→ 等于给攻击者一张「这个服务开了哪些功能」的地图。

**修复**：配 ADMIN_TOKEN 后该接口归入 admin-only（上游已含在 `ADMIN_ONLY_PATH_PATTERNS` 里）。

### 事故 6：`/api/config` 与 `/api/logs` 信息暴露 🟡

- `/api/config` 无需鉴权即返回内部拓扑（各源开关、限流参数、代理配置等）
- `/api/logs` 会返回**真实客户端 IP**

### 事故 7：限流只覆盖部分路由 🟡

限流（`rateLimitMaxRequests`）只作用在**缓存未命中的弹幕路由**上，search/match 不受限流保护。

### 事故 8：本地版本管理残留 🟢

仓库根目录有 `.pr_agent.toml`（上游 PR agent 配置）和 `config/` 目录，跟本 fork 无关。

---

## 5. 修复方案

### 方案 A（推荐）：同步上游 + 自动 re-apply 补丁

**核心思想**：不再冻结整文件，改成「同步后重新打补丁」。

```
1. git checkout upstream/main -- .        # 全量跟随上游
2. node scripts/apply-local-patch.mjs     # 幂等地把 GET/match 补丁打回去
3. npx wrangler deploy --dry-run          # build 门禁：失败就中止，不 push
4. git commit && git push                 # 只在 build 通过时推
```

补丁脚本要点（幂等、可重复执行）：
- 用**字符串锚点**而非行号定位（上游改行号是常态）
- 已打过补丁就跳过（检测 `handleGetMatch` 是否已存在）
- 锚点找不到 → **报错退出**，不要静默跳过（否则补丁静默失效，很难发现）

#### `scripts/apply-local-patch.mjs` 可施工规格

**三个锚点（必须都命中，否则 exit 1）**

| 补丁点 | 文件 | 锚点字符串 | 操作 |
|---|---|---|---|
| ① import | `danmu_api/worker.js` | `import { getBangumi, getComment, getCommentByUrl, getSegmentComment, matchAnime, searchAnime, searchEpisodes } from "./apis/dandan-api.js";` | **在整行末尾追加** `handleGetMatch`（注意是加进这个 `{...}` 括号里，不是新起一行） |
| ② 路由 | `danmu_api/worker.js` | `if (path === "/api/v2/match" && method === "POST") {` | 在该分支**之前**插入 GET 分支 |
| ③ 函数 | `danmu_api/apis/dandan-api.js` | `export async function matchAnime(` | 在其**之前**插入 `handleGetMatch` 函数 |

**GET 路由分支**（插在 POST 分支前）：

```js
if (path === "/api/v2/match" && method === "GET") {
  const fileName = url.searchParams.get("fileName");
  if (!fileName) {
    return new Response(JSON.stringify({ success: false, message: "缺少 fileName 参数" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const result = await handleGetMatch(url, clientIp);
  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}
```

**`handleGetMatch` 实现**（放上游 dandan-api.js 里）：

```js
export async function handleGetMatch(url, clientIp) {
  const fileName = url.searchParams.get("fileName");
  if (!fileName) {
    return { success: false, message: "缺少 fileName 参数" };
  }
  const fakeReq = { json: async () => ({ fileName }), url: url.toString() };
  return await matchAnime(url, fakeReq, clientIp);
}
```

> ⚠️ `fakeReq.url` 是否需要，取决于 `matchAnime` 的实现：
> 上游 1.21.9 已重写匹配流程（`parseFileName`/`extractTitleSeasonEpisode`），**不再引用 `req.url`** →
> 移植到上游版时 `url` 字段多余但无害。
> 但若上游哪天改回依赖 `req.url`，这个字段就是必需的 —— 留着它最省事。

> ⚠️ **锚点① 的坑**：上游是**一个 import 语句导入多个符号**，
> 正确改法是把 `handleGetMatch` **加进现有的 `{ ... }` 括号里**：
> ```js
> import { getBangumi, getComment, getCommentByUrl, getSegmentComment, matchAnime, searchAnime, searchEpisodes, handleGetMatch } from "./apis/dandan-api.js";
> ```
> 新起一行 `import { handleGetMatch } from "./apis/dandan-api.js";` 虽然 JS 语法合法，
> 但**与既有风格不一致**，且脚本锚点要写两套逻辑 —— 不如直接改括号。

**上游改了 `matchAnime` 签名怎么办** → 脚本锚点 ①③ 失配 → 直接 exit 1，CI 变红。
这就是「锚点失配必须让 CI 变红」的强制失败约定：**宁可构建失败，也不能静默打错补丁上线。**

**验收命令**（脚本跑完必须过）：

```bash
npx wrangler deploy --dry-run    # 期望：Total Upload ~5023 KiB，无 error
```

**✅ 本规格已落地为 `scripts/apply-local-patch.mjs`（仓库内可直接用）**

脚本已写入仓库，**三个场景全部实测通过**：

| 场景 | 期望 | 实测结果 |
|---|---|---|
| 全新铺底 upstream 版 | 注入 3 个补丁点 | ✅ `本次实际注入 3 个补丁点` |
| 重复执行（幂等） | 0 点，全跳过 | ✅ `本次实际注入 0 个补丁点`，无重复代码 |
| 锚点失配 | exit 1 + 清晰报错 | ✅ `✘ apply-local-patch 失败：锚点①失配…`，exit=1 |

**编译对照实验**：

| 场景 | `npx wrangler deploy --dry-run` 结果 |
|---|---|
| 不打补丁（= 当前仓库状态） | ❌ `No matching export ... "normalizeSpaces"` + `"resolveOffset"`，2 errors |
| 按本规格打补丁 | ✅ `Total Upload: 5023.16 KiB / gzip: 978.51 KiB`，0 errors |

→ **这份规格是能直接施工的，不是设想。**

**脚本用法**：

```bash
node scripts/apply-local-patch.mjs              # 默认用脚本上两级目录
node scripts/apply-local-patch.mjs /path/to/repo # 显式指定仓库根
```

脚本自带详细注释，包括为什么锚点失配必须 exit 1（宁可构建失败，也不能静默打错补丁上线）。

**注意**：patch 后 `dandan-api.js` 与上游差 32 行、`worker.js` 差 2 行 —— 这是**正常且可接受的**，
因为脚本每次同步后重新打，差异不会累积。

**同时要做的**：
- exclude 清单改为只保护 `scripts/`、`docs/`、`.github/workflows/`（`scripts/apply-local-patch.mjs` 已写好，可直接用）
- `wrangler.toml` 也要保护（否则 `account_id` 又被冲掉）—— 或者让补丁脚本也负责补 `account_id`
- 删掉 deploy 步骤的 `continue-on-error: true`
- 删掉 DEBUG 指纹步骤
- 把 `account_id` 写进 `wrangler.toml`

### 方案 B：把补丁拆成独立小文件

`danmu_api/apis/local-match-get.js` 单独放 `handleGetMatch`，只冻结**这一个新增文件**，
`worker.js` / `dandan-api.js` 跟随上游全量更新。

**问题**：`worker.js` 仍需要加 import 和路由 → 还是得改 `worker.js` → 还是得冻结它 → 还是会崩。
除非改上游源码接受 `handleGetMatch`（不可行）。

### 方案 C：放弃补丁，全量跟随上游

- exclude 清零，仓库永远可编译、同步永不炸
- **前提**：确认没人用 SenPlayer 的 GET 路径
- 顺带放弃 GET/match，只留 POST/match

### 各方案对比

| | A: re-apply 补丁 | B: 拆小文件 | C: 全跟随 |
|---|---|---|---|
| 保留 GET/match | ✅ | ✅ | ❌ |
| 仓库可编译 | ✅ | ❌（worker.js 仍冻结） | ✅ |
| 今后同步再炸 | ❌ | ⚠️ 会 | ❌ |
| 维护成本 | 中（一个脚本） | 中 | 零 |
| 依赖上游继续稳定 | 高 | 高 | 最高 |

---

## 6. 部署与运维手册

### 6.1 本地开发

```bash
cd /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025

npm install                      # 国内建议加 --registry=https://registry.npmmirror.com
cp .env.example .env             # 按需改
npm start                        # Node/Express 入口，默认 9321 端口
npm test                         # node:test 单测，需 Node ≥ 22.3
```

Worker 方式本地预览：
```bash
npx wrangler deploy --dry-run    # 只构建，不部署 —— 验证 build 是否通过
npx wrangler dev                 # 本地跑 Worker
```

### ⚠️ 本地默认**没有配置 `upstream` remote**

clone 下来只有 `origin`（= fork 自己），所以 `git fetch upstream` 会直接报
`fatal: 'upstream' does not appear to be a git repository`。**要先手动加**：

```bash
git remote add upstream https://github.com/huangxd-/danmu_api.git
git fetch upstream
git log --oneline upstream/main -5      # 看上游最新
```

CI 的 `sync_fork.yml` 自己会加 remote，本地没这一步 ——
所以「本地怎么同步上游」的答案就是：手动 fetch + 用 `scripts/apply-local-patch.mjs`
重打补丁，**别指望有 merge 流程**。

### ⚠️ 两个 `.env.example` 别搞混

| 文件 | 内容 |
|---|---|
| `.env.example`（根目录） | **不含 `ADMIN_TOKEN`** —— 只有通用配置 |
| `config/.env.example`（第 30-45 行） | **才有 `ADMIN_TOKEN`** 和 admin 相关开关的完整说明 |

搜 ADMIN_TOKEN 要去 `config/` 那份。

### 6.2 常用接口速查

鉴权：URL 第一段必须等于 `TOKEN`（当前 `<TOKEN>`）或 `ADMIN_TOKEN`。

| 接口 | 方法 | 说明 |
|---|---|---|
| `/api/v2/match` | POST | 文件名 → 弹幕匹配（**本 fork 额外支持 GET `?fileName=`**） |
| `/api/v2/search/anime` | GET | `?keyword=` 搜番 |
| `/api/v2/search/episodes` | GET | `?anime=<animeId>` 搜集 |
| `/api/v2/comment/<episodeId>` | GET | 取弹幕（**依赖内存映射，见事故 3**） |
| `/api/v2/comment?url=<真实页面URL>` | GET | 取弹幕（不依赖 id 映射） |
| `/api/v2/bangumi/<bangumiId>` | GET | 番剧详情 |
| `/api/v2/segmentcomment` | POST | 分段弹幕 |
| `/api/v2/fongmi/danmaku` | GET | 独立代理，不依赖 id 映射 |
| `/api/v2/favorite/*` | - | 收藏（**上游 1.20+ 才有，fork 冻结版 worker.js 里没有此路由 → 404**） |
| `/api/config` | GET | 无鉴权，返回内部配置（见事故 6） |
| `/api/logs` | GET | 含真实客户端 IP（见事故 6） |
| `/api/env/set` `/api/env/add` `/api/env/del` | POST | 改 Worker 环境变量（**无鉴权！** 见事故 5） |

### 6.3 排查手册

**「线上版本不对 / 线上还是老版本」**
→ 查 GitHub Actions 的 run 状态；查 CF 的 Worker deployment 列表（API：`/accounts/{account_id}/workers/scripts/danmu-api/deployments`）

**「改了代码但线上没变」**
→ 大概率是 sync 冲掉了。`git log --oneline -- <你改的文件>` 看是否有 `chore(sync)` 提交把它覆盖了。
→ 检查该文件是否在 sync 的 exclude 清单里。

**「build 报 `No matching export ... for import ...`」**
→ 典型症状：某个被 exclude 冻结的文件 import 了上游已删除的导出。
→ 查上游什么时候删的该导出（`git log -S`），然后决定是解冻该文件还是把该文件升级。

**「弹幕返回空 / comment 404」**
→ 先看 `/api/config` 的 `redisValid` 是否为 `true`（当前应为 `true`）。
→ 再查源站是否本来没有弹幕；可换成 `/api/v2/comment?url=<页面URL>` 直查，或重试/换源。

**「match 匹配不到」**
→ 用 `POST /api/v2/match`；`GET /api/v2/match` 已按方案 C 移除，不要再用 GET 排查。

**「某个接口 404，但上游 README 说有」**
→ 现在 `worker.js` 已跟随上游 v1.21.9；先检查 URL 前缀、`TOKEN` 和请求方法，不要按旧的冻结版排查。

**「某个接口 200 但数据是空的」**
→ Redis 已配置时先别怀疑 Redis；检查源站是否有弹幕、URL 是否正确，以及请求是否带了正确 `TOKEN`。

### 6.5 升级到 v1.21.9 的升级路径（跨越 4 个月，要走完这一节才算升级完）

线上 v1.19.14 → v1.21.9 跨越 4 个月，**不是简单 deploy 就行**。

> **2026-11-10 执行结果：已完成部署，线上 v1.21.9；Redis 已配；按用户要求未配 `ADMIN_TOKEN`，
> 管理接口 401 视为可接受。以下步骤保留为当时的升级方案，实际操作与本文不同处，以本段结果为准。**

#### 步骤 1：先配 ADMIN_TOKEN（否则升级后管理界面直接 401）

> **实际执行时跳过了这一步。** 用户不使用管理页面，接受升级后管理接口 401。
> 如果以后需要管理功能，再按下面步骤单独配置。

线上 `ADMIN_TOKEN = ''`（实测）。上游 1.21.9 的 `ADMIN_ONLY_PATH_PATTERNS` 会在未配置时
对所有管理接口返回 401 —— 升级后 `/api/env/set`、`/api/deploy`、`/api/cache/*`、
`/api/cookie/*` 全部锁死。

→ **升级前**在 CF Worker 的 secret 里加 `ADMIN_TOKEN`（随便一个高强度字符串），
或用 `/api/env/set` 写入（当前版本还没锁，正是最后一次机会）。

**配 ADMIN_TOKEN 时会遇到的几个相关开关**（上游 `config/.env.example` 第 30-45 行，
线上当前全部未配/未启用）：

| 变量 | 默认 | 含义 |
|---|---|---|
| `ADMIN_TOKEN` | 空 | 系统管理访问令牌。**空 = 管理接口不启用访问控制**（= 当前裸奔状态） |
| `FAVORITE_REQUIRE_ADMIN` | `false` | 收藏写入是否必须用 ADMIN_TOKEN。`true` = 任何情况都只能用 ADMIN_TOKEN 写收藏 |
| `LOCAL_DANMU_NOT_REQUIRE_ADMIN` | `false` | 本地弹幕上传/删除是否允许普通 TOKEN。`false` = 仅 ADMIN_TOKEN 可操作 |

> 注意 `ADMIN_TOKEN` 的注释写明：「默认 `TOKEN=87654321` 的免 token 兼容**不适用**于这些接口」。
> 老大用的是自定义 TOKEN（`<TOKEN>`），所以只要配了 `ADMIN_TOKEN` 就能起到隔离作用。

**怎么配**（推荐用 UI，比手改 secret 稳）：

```bash
# 用 admin token 写入（当前版本普通 TOKEN 也能写，见上）
curl -s -X POST "https://dm.ccucc.de5.net/<TOKEN>/api/env/set" \
  -H "Content-Type: application/json" \
  -d '{"key":"ADMIN_TOKEN","value":"<你定的高强度字符串>"}'

# 确认写进去了
curl -s "https://dm.ccucc.de5.net/<TOKEN>/api/config" | grep -o '"ADMIN_TOKEN":"[^"]*"'
```

⚠️ 配之前想清楚：**ADMIN_TOKEN 一旦设置，所有管理接口立即开始强制校验**，
用旧 TOKEN 调管理界面会 401。这是好事，但要知道这个切换点。

#### 步骤 2：决定 GET/match 补丁去留

- 保留 → 走 §5 方案 A（写 re-apply 脚本 + 改 sync workflow）
- 放弃 → 走 §5 方案 C（exclude 清零）

**判定依据**：查线上日志里有没有 GET 方式的 `/api/v2/match` 请求：

```bash
curl -s "https://dm.ccucc.de5.net/<TOKEN>/api/logs" | grep -i "match"
```

（注意：`/api/logs` 含真实客户端 IP，输出别外传。）

#### 步骤 3：修 build（否则根本发不出去）

按 §5 方案 A 改完后，**本地必须先验过**：

```bash
npx wrangler deploy --dry-run     # 2026-11-10 已通过
```

同步后**必须**在 CI 里加同样的 dry-run 作为门禁（失败就别 push），
否则「假绿」会重演。

#### 步骤 4：配 Redis（决定弹幕能不能用）

> **2026-11-10 已完成：** Upstash 免费库已配置，线上 `/api/config` 返回 `redisValid=true`。

如果以后要重新配置或轮换，在 CF Worker 环境变量里加：

```
UPSTASH_REDIS_REST_URL     = <upstash redis url>
UPSTASH_REDIS_REST_TOKEN   = <upstash redis token>
```

（Upstash 免费额度够用；获取方法见上游 README 第 531-532 行。）
配好后用 `/api/config` 确认 `redisValid: true`。

> 注意 Redis 的能力边界：它持久化的是 **id→url 映射**和**收藏**，
> **弹幕正文仍要实时去各视频源抓**。所以「弹幕还是空的」不一定是 Redis 没配好。

#### 步骤 5：升级后冒烟清单

逐条打，**全过才算升级成功**：

```bash
B="https://dm.ccucc.de5.net/<TOKEN>"

# 1. 基础可用
curl -s "$B/api/v2/search/anime?keyword=凡人修仙传" | head -c 200

# 2. match（POST = 上游原生路径，必须通）
curl -s -X POST "$B/api/v2/match" -H "Content-Type: application/json" \
  -d '{"fileName":"凡人修仙传.S01E01.1080p.mkv"}' | head -c 300

# 3. GET /match 已放弃（本 fork 不再要求通过）

# 4. 管理接口现在应该 401（用普通 TOKEN 调）
curl -s -X POST "$B/api/env/set" -H "Content-Type: application/json" -d '{"key":"x","value":"1"}'
# 期望：401（若还是 500/200，说明补丁没生效或 admin 校验没进）

# 5. 已配 Redis 时，确认 config
curl -s "https://dm.ccucc.de5.net/api/config"
# 期望：envs.redisValid=true
```

#### 步骤 6：回滚预案

CF Worker 每次 deploy 都会留版本，回滚路径：

```bash
# 列出部署历史
curl -s -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/workers/scripts/danmu-api/deployments"

# 回滚到指定版本（用上一步返回的 version id）
curl -s -X PUT -H "Authorization: Bearer $CF_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/workers/scripts/danmu-api/versions/$VERSION_ID/content"
```

⚠️ 回滚会**丢失该版本之后新增的 secret / 环境变量**（如新配的 ADMIN_TOKEN、Redis），
回滚后要重新确认 `wrangler.toml` 的 `keep_vars = true` 生效情况。

#### 步骤 7：防「假绿」复发（别再静默 4 个月）

光删 `continue-on-error` 只是让 CI 变红，还需要**有人看**。建议至少做一件事：

- 给 GitHub 仓库配**失败通知**（Actions → Settings → Notifications，或接飞书/webhook）
- 或加一个**外部探活**：定时请求 `/api/v2/search/anime?keyword=test`，
  检查返回的版本号是否与预期一致（模板里带版本号，可从 `/` 或 UI 拿到）
- 或用 `hermes cron` 跑一个定时脚本，检查线上版本 ≠ 仓库版本就告警

### 6.6 凭据怎么取（仓库里只有占位符，值不在这）

> ⚠️ **本仓库是 PUBLIC**（`dvxiaofan/cc_danmu_api-43025`），所以文档里所有敏感值
> 都写成了占位符：`<TOKEN>`、`<CF_ACCOUNT_ID>`、`<CF_ZONE_ID>`、`<WORKER_SUBDOMAIN>`。
> **不要把真实值 commit 进仓库。**

| 占位符 | 是什么 | 真实值从哪取 |
|---|---|---|
| `<TOKEN>` | 鉴权 token，**也是 URL 第一段**（`https://<域名>/<TOKEN>/api/v2/...`）。同时是 Worker 的 secret_text 绑定 `TOKEN` | 服务所有者本人知道；CI 里是 GitHub Secret `CF_API_TOKEN`（那是另一个 CF 凭据） |
| `<CF_ACCOUNT_ID>` | Cloudflare 账号 ID | `wrangler whoami` 或 CF 控制台右侧 |
| `<CF_ZONE_ID>` | `ccucc.de5.net` 的 zone ID | CF 控制台 → 该域名 → Zone 概览 |
| `<WORKER_SUBDOMAIN>` | `*.workers.dev` 子域（CNAME 目标） | CF 控制台 → Workers → danmu-api |

**为什么 token 放 URL 第一段**：这是上游的设计（`worker.js` 从 pathname 第一段取 token，
后面全部是 API 路径）。所以 token 会出现在客户端配置、日志、播放器设置里 —— 属于半公开信息，
但**仍然不该进公开仓库的 git 历史**（一旦 push 就永久留存，删改也难彻底）。

**换 token 的影响**：改 Worker secret `TOKEN` 后，所有客户端（Sonarr / 播放器）要同步更新 URL。

### 6.6 提交这批文档时的坑：CLAUDE.md 被全局 gitignore 屏蔽

老大的全局 `~/.gitignore_global` 第 52 行有 `CLAUDE.md`（UGit 自动加的 Claude Code 段），
所以 `git add CLAUDE.md` 会直接报错：

```
The following paths are ignored by one of your .gitignore files:
CLAUDE.md
```

**解法**：仓库自己的 `.gitignore` 末尾已加反屏蔽规则：

```
# 本 fork 的 AI 约定文件（全局 gitignore 屏蔽了 CLAUDE.md，这里反屏蔽）
!CLAUDE.md
```

`AGENTS.md` 不受影响（全局没屏蔽它）→ **这是首选入口文件**。

验证过：`git add --dry-run AGENTS.md CLAUDE.md docs/ scripts/` 五个文件全部 add 成功。

### 6.8 GitHub Actions 现状

.github/workflows 下**只有两个文件**（没有独立的 deploy.yml）：

| workflow | 作用 | 状态 |
|---|---|---|
| `sync_fork.yml` | 每天 02:23（北京）同步上游 → 测试 → dry-run → commit → `wrangler deploy` | ✅ 2026-11-10 起已恢复正常；最近成功 run `42788037976` |
| `docker-image.yml` | 构建 Docker 镜像 | ⚠️ 因缺 Docker Hub 密钥会红；与 Cloudflare 服务无关 |

**踩坑提醒**：workflow 里曾用「patch 文件 + `git apply`」方案（`01-get-match.patch` + `99_local_patches.yml`），
后来废弃改成「整树 checkout + exclude」—— **就是这一步把 build 搞崩的**。改同步策略时别再退回整文件冻结。

---

## 7. 接手者检查清单

接手这个 fork 时，按顺序确认：

- [ ] 读本文档 + 上游 README
- [ ] 确认 `git remote -v` 指向 `dvxiaofan/cc_danmu_api-43025`，上游是 `huangxd-/danmu_api`
- [ ] 在干净 main 上跑 `npx wrangler deploy --dry-run`，**确认能过**（2026-11-10：已通过）
- [ ] 查 GitHub Actions 最近 run 是不是绿的（2026-11-10：`Fork Sync + Deploy` run `42788037976` 成功）
- [ ] 查 CF Worker 当前部署版本 vs 仓库版本（2026-11-10：均为 v1.21.9）
- [ ] 确认 GET/match 补丁状态（2026-11-10：已按方案 C 移除，不要恢复）
- [ ] 确认 ADMIN_TOKEN 是否配置（2026-11-10：未配，管理接口 401 属预期）
- [ ] 确认 Redis 是否配置（2026-11-10：已配 Upstash，`redisValid=true`）
- [ ] 确认是否需要把 `<TOKEN>` 轮换（它在 URL 里，视为已泄露）
- [ ] 修 sync 策略前，先确认**本地补丁到底还有没有人用**

---

## 8. 关键坐标速查

```
Worker 名        danmu-api
CF Account ID    <CF_ACCOUNT_ID>
域名             dm.ccucc.de5.net
鉴权 token       <TOKEN>  (Worker secret_text: TOKEN)
Zone ID          <CF_ZONE_ID>
DNS              dm.ccucc.de5.net → <WORKER_SUBDOMAIN>.workers.dev (CNAME, 橙云代理)

上游仓库         https://github.com/huangxd-/danmu_api
Fork 仓库        https://github.com/dvxiaofan/cc_danmu_api-43025
本地路径         /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025

补丁源头 commit  472d5e0  (2026-06-01, GET /api/v2/match)
补丁被冲后补回  fe84aa3  (2026-07-13)
account_id 修复  3c6b497  (2026-07-13) ← 被 sync 冲掉，事故 1 根因

上游删导出 commit
  280b2327 (2026-09-20)  删 common-util.js 的 normalizeSpaces
  cad83795 (2026-11-01)  删 offset-util.js 的 resolveOffset
```

---

*文档维护：随 fork 状态变化更新。最近更新：2026-11-10（初版，基于 v1.21.9 上游 + fork main 实测）。*
