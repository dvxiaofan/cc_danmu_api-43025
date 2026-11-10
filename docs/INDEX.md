# 弹幕 API 服务（cc_danmu_api-43025）

Cloudflare Workers 上的弹弹播放（DanDanPlay）协议兼容弹幕 API。
上游 `huangxd-/danmu_api` 的伪 fork。

**线上**：`https://dm.ccucc.de5.net/<TOKEN>`（`<TOKEN>` 是普通鉴权 token）

## 当前状态（2026-11-10）

1. 已放弃 `GET /api/v2/match` 补丁，全量跟随上游 **v1.21.9**。
2. 仓库代码 build 通过，测试 **873/873** 通过。
3. 线上已部署为 **v1.21.9**（GitHub Actions run `42788037976` 成功）。
4. CI 已改为安装依赖 → 测试 → 编译检查 → 部署，失败会变红。
5. 未配 `ADMIN_TOKEN`：管理接口 401 属预期，日常播放不受影响。
6. Upstash Redis 已配置：线上 `/api/config` 的 `redisValid` 为 `true`。
7. 当天执行细节、验证命令和遗留事项见 [CHANGELOG.md](CHANGELOG.md)。

## 文档

| 文档 | 用途 |
|---|---|
| [AGENTS.md](../AGENTS.md) | **当前操作入口**：状态、同步策略、常用命令、限制 |
| [CLAUDE.md](../CLAUDE.md) | Claude Code 自动入口，指向 AGENTS.md |
| [docs/CHANGELOG.md](CHANGELOG.md) | 按日期记录本 fork 的运维、部署和配置变更 |
| [docs/FORK_NOTES.md](FORK_NOTES.md) | 修复前的历史事故记录，仅供复盘，部分内容已过时 |
| [README.md](../README.md) | 上游完整功能文档（每轮 sync 覆盖，不含本 fork 特殊性） |

## 快速验证

```bash
cd /Users/ccfun/Desktop/CCFUN/ai-coding/cc_danmu_api-43025
npm test
npx wrangler deploy --dry-run

curl -s https://dm.ccucc.de5.net/api/config
# 期望：version=1.21.9，envs.redisValid=true
```
