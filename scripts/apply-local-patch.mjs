#!/usr/bin/env node
/**
 * apply-local-patch.mjs — 幂等地把本 fork 的本地补丁打回同步后的代码
 *
 * 背景：本 fork 是「伪 fork」，sync 用 `git checkout upstream/main -- .` 整树覆盖。
 *      为了保住 GET /api/v2/match 补丁，旧做法是 exclude 整文件冻结
 *      （danmu_api/worker.js + danmu_api/apis/dandan-api.js），
 *      代价是丢掉上游 13 个新路由 + build 编译失败。
 *      本脚本改为「同步后重新打补丁」，让 exclude 只保护 scripts/ docs/ .github/workflows/。
 *
 * 用法：
 *   node scripts/apply-local-patch.mjs [仓库根目录]
 *   默认仓库根目录 = 本脚本上两级目录
 *
 * 设计约束（重要，改动前先读）：
 *   1. 幂等：已打过补丁则跳过，重复执行安全。
 *   2. 锚点失配 → exit 1（绝不能静默跳过）。
 *      上游若改了 matchAnime 签名或 import 结构，必须让 CI 变红，
 *      宁可构建失败，也不能静默打错补丁上线。
 *   3. 只用字符串锚点，不用行号（上游改行号是常态）。
 *
 * 验收：node scripts/apply-local-patch.mjs && npx wrangler deploy --dry-run
 *       实测：不打补丁 → 2 errors；打补丁 → Total Upload 5023.16 KiB，0 errors。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));

const WORKER_PATH = path.join(ROOT, 'danmu_api/worker.js');
const DANDAN_PATH = path.join(ROOT, 'danmu_api/apis/dandan-api.js');

// ── 补丁内容 ────────────────────────────────────────────────────────────────

const GET_ROUTE = `if (path === "/api/v2/match" && method === "GET") {
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

  // GET /api/v2/match
  `;

const HANDLE_GET_MATCH = `export async function handleGetMatch(url, clientIp) {
  const fileName = url.searchParams.get("fileName");
  if (!fileName) {
    return { success: false, message: "缺少 fileName 参数" };
  }
  const fakeReq = { json: async () => ({ fileName }), url: url.toString() };
  return await matchAnime(url, fakeReq, clientIp);
}

`;

// ── 锚点 ────────────────────────────────────────────────────────────────────

// ① 上游是一个 import 语句导入多个符号 → handleGetMatch 要加进现有 { } 里
const ANCHOR_IMPORT =
  'import { getBangumi, getComment, getCommentByUrl, getSegmentComment, matchAnime, searchAnime, searchEpisodes } from "./apis/dandan-api.js";';
const ANCHOR_IMPORT_PATCHED =
  'import { getBangumi, getComment, getCommentByUrl, getSegmentComment, matchAnime, searchAnime, searchEpisodes, handleGetMatch } from "./apis/dandan-api.js";';

// ② GET 分支插到 POST 分支之前
const ANCHOR_POST_ROUTE = 'if (path === "/api/v2/match" && method === "POST") {';

// ③ handleGetMatch 插到 matchAnime 之前
const ANCHOR_MATCH_ANIME = 'export async function matchAnime(';

// ── 主流程 ──────────────────────────────────────────────────────────────────

function fail(msg) {
  console.error(`✘ apply-local-patch 失败：${msg}`);
  process.exit(1);
}

if (!fs.existsSync(WORKER_PATH)) fail(`找不到 ${WORKER_PATH}`);
if (!fs.existsSync(DANDAN_PATH)) fail(`找不到 ${DANDAN_PATH}`);

let worker = fs.readFileSync(WORKER_PATH, 'utf8');
let dandan = fs.readFileSync(DANDAN_PATH, 'utf8');
let applied = 0;

// ① import
if (worker.includes('handleGetMatch')) {
  console.log('· ① import 已存在，跳过');
} else {
  if (!worker.includes(ANCHOR_IMPORT)) {
    fail(
      `锚点①失配：worker.js 里找不到\n    ${ANCHOR_IMPORT}\n` +
        `  上游可能改了 import 结构 —— 请人工检查后更新本脚本的锚点。`
    );
  }
  worker = worker.replace(ANCHOR_IMPORT, ANCHOR_IMPORT_PATCHED);
  applied++;
  console.log('✓ ① 已注入 import handleGetMatch');
}

// ② GET 路由
if (worker.includes('path === "/api/v2/match" && method === "GET"')) {
  console.log('· ② GET 路由已存在，跳过');
} else {
  if (!worker.includes(ANCHOR_POST_ROUTE)) {
    fail(
      `锚点②失配：worker.js 里找不到\n    ${ANCHOR_POST_ROUTE}\n` +
        `  上游可能改了路由写法 —— 请人工检查后更新本脚本的锚点。`
    );
  }
  worker = worker.replace(ANCHOR_POST_ROUTE, GET_ROUTE + ANCHOR_POST_ROUTE);
  applied++;
  console.log('✓ ② 已注入 GET /api/v2/match 路由');
}

// ③ handleGetMatch 函数
if (dandan.includes('export async function handleGetMatch')) {
  console.log('· ③ handleGetMatch 已存在，跳过');
} else {
  if (!dandan.includes(ANCHOR_MATCH_ANIME)) {
    fail(
      `锚点③失配：dandan-api.js 里找不到\n    ${ANCHOR_MATCH_ANIME}\n` +
        `  上游可能改了 matchAnime 签名 —— 请人工检查后更新本脚本的锚点。`
    );
  }
  dandan = dandan.replace(ANCHOR_MATCH_ANIME, HANDLE_GET_MATCH + ANCHOR_MATCH_ANIME);
  applied++;
  console.log('✓ ③ 已注入 handleGetMatch 函数');
}

fs.writeFileSync(WORKER_PATH, worker);
fs.writeFileSync(DANDAN_PATH, dandan);

console.log(`\n本次实际注入 ${applied} 个补丁点（其余已存在）`);
console.log('下一步：npx wrangler deploy --dry-run   ← 必须通过才能提交');
