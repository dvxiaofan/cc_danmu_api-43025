# CLAUDE.md

本仓库是上游 `huangxd-/danmu_api` 的**伪 fork**（同步方式为整树覆盖 + exclude 清单，
不能用 `git merge upstream/main`）。

**动手前先读 `AGENTS.md`，再读 `docs/FORK_NOTES.md`。**（索引：`docs/INDEX.md`）

三条最要紧的：

1. **不在 exclude 清单里的手动改动，下次每日同步会被静默冲掉** —— 清单在
   `.github/workflows/sync_fork.yml` 第 37-41 行。
2. **当前仓库 build 不过**，CI 部署也挂了 4 个月 —— 根因和解法见 `docs/FORK_NOTES.md` §4。
3. **`README.md` 是上游原文，每轮 sync 会被覆盖**，不包含本 fork 的任何特殊性。
   本 fork 的信息全在 `docs/` 下。
