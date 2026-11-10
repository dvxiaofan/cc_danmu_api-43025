# CLAUDE.md

本仓库是上游 `huangxd-/danmu_api` 的**伪 fork**（整树覆盖同步，不能用
`git merge upstream/main`）。

**动手前先读 `AGENTS.md`。** `docs/FORK_NOTES.md` 是修复前的历史事故记录，
部分内容已过时，以 `AGENTS.md` 的当前状态为准。

三条最要紧的：

1. **2026-11-10 已按方案 C 全量跟随上游 v1.21.9**：GET /match 补丁和整文件冻结已移除，
   `scripts/apply-local-patch.mjs` 已删除。
2. **已成功部署到线上 v1.21.9**；代码 build 通过、测试 873/873 通过；CI 已改为安装依赖 → 测试 → 编译检查 → 部署。
3. **Upstash Redis 已配置**（线上 `redisValid=true`），但 `ADMIN_TOKEN` 按需求未配，管理接口 401 属预期；
   `GET /api/v2/match` 已移除。`README.md` 是上游原文，每轮 sync 会被覆盖；本 fork 的说明在
   `AGENTS.md`、`docs/INDEX.md` 和 `docs/CHANGELOG.md`。
