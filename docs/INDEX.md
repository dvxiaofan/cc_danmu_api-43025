# 弹幕 API 服务（cc_danmu_api-43025）

Cloudflare Workers 上的弹弹播放（DanDanPlay）协议兼容弹幕 API 服务。
上游 `huangxd-/danmu_api` 的伪 fork。

**线上**：`https://dm.ccucc.de5.net/<TOKEN>`（`<TOKEN>` 是 URL 里的鉴权 token）

## 文档

| 文档 | 用途 |
|---|---|
| [AGENTS.md](../AGENTS.md) | **给 AI / 新人的入口** —— 30 秒速览 + 伪 fork 铁律 + 别犯的错。多数工具（Claude Code / Codex / Cursor）会**自动读取** |
| [CLAUDE.md](../CLAUDE.md) | Claude Code 的自动入口，内容指向 AGENTS.md |
| [docs/FORK_NOTES.md](docs/FORK_NOTES.md) | **先看这个** —— fork 专属运维说明：本地补丁、已知事故、修复方案、升级路径、排查手册、接手清单 |
| [README.md](README.md) | 上游项目的完整功能文档（870 行，每轮 sync 会被覆盖，**不含本 fork 特殊性**，理解上游功能用） |

## 可直接用的脚本

| 脚本 | 用途 |
|---|---|
| `scripts/apply-local-patch.mjs` | 幂等地把本 fork 的 GET /match 补丁打回同步后的代码。锚点失配会 exit 1（强制 CI 变红）。已实测：打补丁后 build 通过（5023 KiB，0 errors） |

## 快速上手

```bash
npm install --registry=https://registry.npmmirror.com
cp .env.example .env
npm start                        # Node/Express，端口 9321
npx wrangler deploy --dry-run    # 验证 Worker build 是否通过
```

## 四句话说清现状

1. 线上跑的是 **v1.19.14**，仓库代码是 **v1.21.9** —— CI 部署从 2026-07-19 起一直失败，且被 `continue-on-error` 掩盖成绿的。
2. 仓库当前 **build 不过** —— sync 的整文件冻结策略撞上上游删导出函数。
3. 本地只有一处独有功能：`GET /api/v2/match?fileName=`（兼容 SenPlayer 等只发 GET 的播放器）。
4. 线上管理接口**当前无 admin 鉴权**（`ADMIN_TOKEN` 未配）—— 但上游 1.21.9 已修，升级会自动锁上。升级前先配 `ADMIN_TOKEN`，否则升级后管理界面 401。

细节和修复方案全在 [docs/FORK_NOTES.md](docs/FORK_NOTES.md)。
