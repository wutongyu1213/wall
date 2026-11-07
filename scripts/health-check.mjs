#!/usr/bin/env node
/**
 * health-check.mjs — 体系自检
 * ---------------------------------------------------------------------------
 * 这个脚本回答两个问题，而这两个问题目前没有人回答：
 *
 *   1. 审核还在跑吗？
 *      巡检工作流可能因为余额、服务商、密钥、代码 bug 悄悄停摆，
 *      而 Actions 页面只看最近一次运行的话，看不出「三天没成功过」。
 *
 *   2. 安全基线回退了吗？
 *      前几轮修的东西（视图、权限、照片签名）都靠人工探一次，
 *      修完没人守着，改一次库就可能悄悄回到解放前。
 *
 * 设计取舍：
 *   - 安全项【只报告，不判定失败】。因为现在七项都没修，天天红会让人脱敏。
 *     等 sql/ 跑完，把 BASELINE_FIXED 打开，未通过就真的会红。
 *   - 只有「巡检停摆」会真的失败——那是运维事故，不是待办事项。
 * ---------------------------------------------------------------------------
 */

const {
  SUPABASE_URL = 'https://dpceuvqtwvhoipxhozxz.supabase.co',
  SUPABASE_ANON_KEY,
  GITHUB_TOKEN,
  GITHUB_REPOSITORY,
  MAX_SILENT_HOURS = '3',
  BASELINE_FIXED = '',
} = process.env;

if (!SUPABASE_ANON_KEY) {
  console.error('缺少 SUPABASE_ANON_KEY');
  process.exit(1);
}

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };
const rows = [];
let hardFail = null;

/* ---------------- 1. 巡检是否还在跑 ---------------- */
async function checkPipeline() {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    rows.push(['巡检新鲜度', '跳过', '未提供 GITHUB_TOKEN（本地运行属正常）']);
    return;
  }
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/actions/workflows/ai-review.yml/runs?per_page=20`;
  let data;
  try {
    const r = await fetch(url, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
      },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    data = await r.json();
  } catch (e) {
    rows.push(['巡检新鲜度', '未知', `查不到运行记录：${e.message}`]);
    return;
  }

  const now = Date.now();
  const limit = Number(MAX_SILENT_HOURS) * 3600e3;
  const recent = (data.workflow_runs || []).filter(
    (x) => now - new Date(x.created_at).getTime() < limit,
  );
  const ok = recent.filter((x) => x.conclusion === 'success');

  if (ok.length) {
    const last = ok[0];
    const mins = Math.round((now - new Date(last.created_at).getTime()) / 60000);
    rows.push(['巡检新鲜度', '✅ 正常', `${mins} 分钟前成功过一次（近 ${MAX_SILENT_HOURS}h 内成功 ${ok.length} 次）`]);
  } else if (recent.length) {
    const last = recent[0];
    rows.push(['巡检新鲜度', '🔴 停摆', `近 ${MAX_SILENT_HOURS}h 有 ${recent.length} 次运行，但没有一次成功（最近一次：${last.conclusion}）`]);
    hardFail = `巡检近 ${MAX_SILENT_HOURS} 小时没有一次成功，审核实际处于停摆`;
  } else {
    rows.push(['巡检新鲜度', '🔴 停摆', `近 ${MAX_SILENT_HOURS}h 完全没有运行记录`]);
    hardFail = `巡检近 ${MAX_SILENT_HOURS} 小时完全没跑，定时任务可能被停用`;
  }
}

/* ---------------- 2. 安全基线 ---------------- */
/* 注意两个容易误判成「已收口」的坑：
   a) candidate_photos 没有 id 列，查 id 会返回 400 —— 那是参数错，不是权限拒。
   b) 签名一个不存在的路径也会返回 400/404 —— 必须先取真实照片路径再签。
   这两处都会让探针「假阳性」，比不查更危险。 */
async function probe(name, fn, okWhen, failLabel = '⚠️ 仍开放') {
  let status = '?';
  let detail = '';
  try {
    const r = await fn();
    status = r.status;
    detail = r.detail || '';
  } catch (e) {
    status = 'ERR';
    detail = e.message.slice(0, 60);
  }
  const passed = okWhen(status);
  rows.push([name, passed ? '✅ 已收口' : failLabel, `${status} ${detail}`.trim()]);
  return passed;
}

const get = (path) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: H }).then((r) => ({
    status: r.status,
    detail: r.status === 200 ? '' : '(被拒)',
  }));

async function pickPhotoPath() {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/wall_candidates?select=photo_url&limit=1`, { headers: H });
  if (!r.ok) return null;
  const j = await r.json().catch(() => []);
  return (j && j[0] && j[0].photo_url) || null;
}

async function checkBaseline() {
  const realPath = await pickPhotoPath();

  const probes = [
    ['wall 原表匿名读', () => get('wall?select=id&limit=1'), (s) => s !== 200],
    ['wall 公开视图可用', () => get('wall_public?select=id&limit=1'), (s) => s === 200, '⚠️ 未创建'],
    ['wall_candidates 原表', () => get('wall_candidates?select=id&limit=1'), (s) => s !== 200],
    ['候选公开视图可用', () => get('wall_candidates_public?select=id&limit=1'), (s) => s === 200, '⚠️ 未创建'],
    ['candidate_photos 原表', () => get('candidate_photos?select=candidate_id&limit=1'), (s) => s !== 200],
    [
      '匿名照片签名',
      async () => {
        if (!realPath) return { status: 'NOPATH', detail: '(取不到真实照片路径，无法判定)' };
        const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/wall-photos/${realPath}`, {
          method: 'POST',
          headers: { ...H, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: 60 }),
        });
        return { status: r.status, detail: r.status === 200 ? '(能直接签到图)' : '' };
      },
      (s) => s >= 400 && s !== 'NOPATH',
    ],
    [
      '照片签名 Edge',
      async () => {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/wall-photo-sign`, { headers: H });
        return { status: r.status };
      },
      (s) => s !== 404,
      '⚠️ 未部署',
    ],
  ];

  let done = 0;
  let unknown = 0;
  for (const [name, fn, ok, failLabel] of probes) {
    const passed = await probe(name, fn, ok, failLabel);
    if (passed) done++;
    if (rows[rows.length - 1][2].startsWith('NOPATH')) unknown++;
  }
  return { done, total: probes.length, unknown };
}

/* ---------------- 主流程 ---------------- */
(async () => {
  await checkPipeline();
  const base = await checkBaseline();

  const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  console.log(`\n表白墙体系自检 · ${stamp}\n`);
  const w = [16, 10];
  for (const [n, s, d] of rows) console.log(`  ${n.padEnd(w[0])} ${s.padEnd(w[1])} ${d}`);

  const md = [
    '### 表白墙体系自检',
    '',
    `时间：${stamp}`,
    '',
    '| 检查项 | 结果 | 说明 |',
    '|---|---|---|',
    ...rows.map(([n, s, d]) => `| ${n} | ${s} | ${d} |`),
    '',
    `安全基线：**${base.done}/${base.total}** 已收口。`,
    '',
    base.done < base.total
      ? '> 未收口的项在 `sql/` 里有对应脚本。按 README 的顺序执行即可，不要跳步。'
      : '> 全部收口完成。',
  ].join('\n');

  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      const { appendFileSync } = await import('node:fs');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
    } catch { /* 忽略 */ }
  }

  /* 只有运维事故才让 CI 变红；安全待办只提示，避免天天红导致脱敏 */
  if (hardFail) {
    console.log(`::error title=审核停摆::${hardFail}`);
    process.exit(1);
  }
  if (BASELINE_FIXED === '1' && base.done < base.total) {
    console.log(`::error title=安全基线回退::仍有 ${base.total - base.done} 项未收口`);
    process.exit(1);
  }
  if (base.done < base.total) {
    console.log(`::warning title=安全基线::仍有 ${base.total - base.done} 项未收口（见 sql/README.md）`);
  }
})().catch((e) => {
  console.log(`::error title=自检失败::${e.message}`);
  process.exit(1);
});
