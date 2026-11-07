#!/usr/bin/env node
/**
 * ai-review.mjs — 定时内容巡检
 * ---------------------------------------------------------------------------
 * 每 30 分钟由 GitHub Actions 触发：
 *   1. 拉取表白墙所有 status=ok 的帖子
 *   2. 逐条交给 AI 判定风险（0~1）
 *   3. 风险 >= 阈值 → 调 wall-admin 的 hide 动作先隐藏（可撤销，不删除）
 *   4. 把「隐藏了什么、为什么」发到指定邮箱
 *
 * 为什么用 GitHub Actions 而不是浏览器里定时：
 *   浏览器定时只在管理员页面开着时才跑，人一走就停；Actions 是真正的服务端定时，
 *   且密钥存在仓库 Secrets 里（加密），不会被任何访客拿到。
 *
 * 安全约定：
 *   - 密钥只从环境变量读，绝不打印、绝不写进仓库
 *   - 缺 ADMIN_PWD 时自动进入「只报告不隐藏」的演练模式
 * ---------------------------------------------------------------------------
 */

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  ADMIN_PWD,
  AI_API_KEY,
  AI_BASE_URL,
  AI_MODEL,
  AI_PROVIDER_NAME,
  RISK_THRESHOLD = '0.75',
  MAX_ITEMS = '60',
  MAIL_HOST,
  MAIL_PORT = '465',
  MAIL_USER,
  MAIL_PASS,
  MAIL_TO,
  DRY_RUN,
} = process.env;

const THRESHOLD = Number(RISK_THRESHOLD) || 0.75;
const LIMIT = Math.min(200, Math.max(1, Number(MAX_ITEMS) || 60));
const isDry = DRY_RUN === '1' || !ADMIN_PWD;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('缺少 SUPABASE_URL / SUPABASE_ANON_KEY');
  process.exit(1);
}
/* 还没配密钥属于「尚未启用」，不是故障。
   这里以 0 退出，避免每 30 分钟给你发一封 Actions 失败通知；
   配好 Secrets 后下一次定时就会自动开始工作。 */
if (!AI_API_KEY) {
  console.log('[skip] 尚未配置 AI_API_KEY，本次跳过巡检。');
  console.log('[skip] 到 Settings → Secrets and variables → Actions 添加后，下一次定时自动生效。');
  process.exit(0);
}

const SYS_PROMPT =
  '你是校园表白墙的内容审核助手。判断这段文本是否需要在校园公开空间隐藏。' +
  '重点看：人身攻击/辱骂/嘲讽同学、性暗示或低俗、泄露真实姓名加班级等可识别信息、' +
  '手机号/QQ/微信号等联系方式、诱导线下见面、自伤自杀倾向、诈骗或广告。' +
  '不要因为是表白、玩笑、谐音梗或网络流行语就判违规。' +
  '只输出 JSON：{"risk":0到1的小数,"reason":"不超过20字的中文理由"}';

/* 常见 OpenAI 兼容中转的候选地址，仅在没配 AI_BASE_URL 时用于自动探测 */
const CANDIDATES = [
  // agens.cn 可能只在 Actions 的干净网络下可用（本地代理会掐掉 TLS 握手）
  ['agens.cn', 'https://agens.cn/v1', ''],
  ['agens.cn(api)', 'https://api.agens.cn/v1', ''],
  ['agens.cn(http)', 'http://agens.cn/v1', ''],
  ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat'],
  ['Moonshot', 'https://api.moonshot.cn/v1', 'moonshot-v1-8k'],
  ['阿里百炼', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen-turbo'],
  ['硅基流动', 'https://api.siliconflow.cn/v1', 'Qwen/Qwen2.5-7B-Instruct'],
  ['智谱', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash'],
  ['阶跃星辰', 'https://api.stepfun.com/v1', 'step-1-8k'],
  ['OpenRouter', 'https://openrouter.ai/api/v1', 'openai/gpt-4o-mini'],
];

/* 中转站常见模型名，探测时逐个试，避免因模型名不对而误判"服务商不可用" */
const MODEL_FALLBACKS = ['gpt-4o-mini', 'gpt-3.5-turbo', 'deepseek-chat', 'qwen-turbo', 'glm-4-flash', 'moonshot-v1-8k'];

function log(...a) {
  console.log(`[${new Date().toISOString()}]`, ...a);
}

async function postJSON(url, headers, body, timeoutMs = 25000) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(tid);
  }
}

async function getJSON(url, headers, timeoutMs = 20000) {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers, signal: ctl.signal });
    const text = await r.text();
    return { ok: r.ok, status: r.status, text };
  } finally {
    clearTimeout(tid);
  }
}

/* ---------------- 1. 确定服务商 ---------------- */
async function probeModel(base, preferred) {
  const models = preferred ? [preferred] : [];
  for (const m of MODEL_FALLBACKS) if (!models.includes(m)) models.push(m);
  for (const model of models) {
    const r = await postJSON(
      base + '/chat/completions',
      { Authorization: 'Bearer ' + AI_API_KEY },
      { model, max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] },
      12000,
    ).catch(() => ({ ok: false, status: 0, text: '' }));
    if (r.ok) return model;
  }
  return null;
}

async function resolveProvider() {
  if (AI_BASE_URL) {
    const base = AI_BASE_URL.replace(/\/+$/, '');
    log('使用已配置的接口地址：' + base);
    const model = await probeModel(base, AI_MODEL);
    if (!model) throw new Error('接口地址可达但模型不可用，请检查 AI_MODEL 是否填写正确');
    return { name: AI_PROVIDER_NAME || '自定义', base, model, detected: false };
  }

  log('未配置 AI_BASE_URL，开始自动探测…');
  for (const [name, base, defaultModel] of CANDIDATES) {
    const r = await postJSON(
      base + '/chat/completions',
      { Authorization: 'Bearer ' + AI_API_KEY },
      { model: defaultModel || 'gpt-4o-mini', max_tokens: 4, messages: [{ role: 'user', content: 'hi' }] },
      10000,
    ).catch(() => ({ ok: false, status: 0, text: '' }));
    if (r.ok) {
      log('探测成功：' + name);
      return { name, base, model: defaultModel || 'gpt-4o-mini', detected: true };
    }
    log('  ' + name + ' → ' + (r.status || 'timeout'));
    // 有些中转站不认默认模型名，但服务本身可用 → 再试一串常见模型
    const alt = await probeModel(base, AI_MODEL);
    if (alt) {
      log('探测成功（换模型）：' + name + ' / ' + alt);
      return { name, base, model: alt, detected: true };
    }
  }
  throw new Error(
    '所有候选服务商都没通过认证。请到仓库 Settings → Secrets 新增 AI_BASE_URL，' +
    '填 agens 控制台里给的接口地址（一般形如 https://xxx/v1），必要时再设 AI_MODEL。'
  );
}

/* ---------------- 2. 取数据 ---------------- */
async function fetchPosts() {
  const u = `${SUPABASE_URL}/rest/v1/wall?select=id,nickname,target_name,love_msg,like_count,created_ts&status=eq.ok&order=created_ts.desc&limit=${LIMIT}`;
  const r = await getJSON(u, { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` });
  if (!r.ok) throw new Error(`读取帖子失败 HTTP ${r.status}：${r.text.slice(0, 120)}`);
  return JSON.parse(r.text) || [];
}

async function fetchCandidates() {
  // 只读，用于报告；照片墙的「隐藏」语义与表白墙不同，不在这里自动处置
  const u = `${SUPABASE_URL}/rest/v1/wall_candidates?select=id,kind,nickname,msg&status=eq.ok&limit=50`;
  const r = await getJSON(u, { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` });
  if (!r.ok) return [];
  return JSON.parse(r.text) || [];
}

/* ---------------- 3. AI 判定 ---------------- */
async function judge(provider, text) {
  const r = await postJSON(
    `${provider.base}/chat/completions`,
    { Authorization: `Bearer ${AI_API_KEY}` },
    {
      model: provider.model,
      temperature: 0,
      max_tokens: 120,
      messages: [
        { role: 'system', content: SYS_PROMPT },
        { role: 'user', content: `内容：${text}` },
      ],
    },
  );
  if (!r.ok) throw new Error(`HTTP ${r.status} ${r.text.slice(0, 100)}`);
  const data = JSON.parse(r.text);
  let content = (((data || {}).choices || [{}])[0].message || {}).content || '';
  const m = content.match(/\{[\s\S]*\}/);
  if (m) content = m[0];
  const obj = JSON.parse(content);
  let risk = Number(obj.risk);
  if (!Number.isFinite(risk)) risk = 0;
  return { risk: Math.max(0, Math.min(1, risk)), reason: String(obj.reason || '').slice(0, 40) };
}

/* ---------------- 4. 隐藏 ---------------- */
async function hidePost(id) {
  if (isDry) return { ok: true, dry: true };
  const r = await postJSON(
    `${SUPABASE_URL}/functions/v1/wall-admin`,
    { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    { admin: ADMIN_PWD, act: 'hide', id },
  );
  let j = null;
  try { j = JSON.parse(r.text); } catch { j = null; }
  return { ok: !!(j && j.ok), raw: r.text.slice(0, 120) };
}

/* ---------------- 5. 发邮件 ---------------- */
async function sendMail(subject, html) {
  if (!MAIL_HOST || !MAIL_USER || !MAIL_PASS || !MAIL_TO) {
    log('未配置邮箱，跳过发信（报告见下方日志）');
    return false;
  }
  let nodemailer;
  try {
    nodemailer = (await import('nodemailer')).default;
  } catch {
    log('未安装 nodemailer，跳过发信');
    return false;
  }
  const port = Number(MAIL_PORT) || 465;
  const tx = nodemailer.createTransport({
    host: MAIL_HOST,
    port,
    secure: port === 465,
    auth: { user: MAIL_USER, pass: MAIL_PASS },
  });
  await tx.sendMail({
    from: `"表白墙巡检" <${MAIL_USER}>`,
    to: MAIL_TO,
    subject,
    html,
  });
  log('邮件已发送');
  return true;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* ---------------- 主流程 ---------------- */
(async () => {
  const provider = await resolveProvider();
  log(`服务商：${provider.name} / 模型：${provider.model}${provider.detected ? '（自动探测）' : ''}`);
  log(isDry ? '⚠️ 演练模式：只报告，不隐藏（未配置 ADMIN_PWD）' : `自动隐藏阈值：风险 ≥ ${THRESHOLD}`);

  const posts = await fetchPosts();
  log(`待检查帖子：${posts.length} 条`);

  const hidden = [];
  const flagged = [];
  let failed = 0;

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    const text = `${p.nickname || '匿名'} 对 ${p.target_name || ''}：${p.love_msg || ''}`;
    if (!String(p.love_msg || '').trim()) continue;
    let res;
    try {
      res = await judge(provider, text);
    } catch (e) {
      failed++;
      log(`  #${p.id} 判定失败：${e.message}`);
      continue;
    }
    if (res.risk >= 0.45) {
      const item = { id: p.id, nick: p.nickname, target: p.target_name, msg: p.love_msg, ...res };
      flagged.push(item);
      if (res.risk >= THRESHOLD) {
        const h = await hidePost(p.id);
        if (h.ok) {
          item.hidden = true;
          hidden.push(item);
          log(`  #${p.id} 风险 ${(res.risk * 100).toFixed(0)}% → ${isDry ? '将隐藏（演练）' : '已隐藏'}｜${res.reason}`);
        } else {
          log(`  #${p.id} 隐藏失败：${h.raw}`);
        }
      } else {
        log(`  #${p.id} 风险 ${(res.risk * 100).toFixed(0)}% → 仅标记｜${res.reason}`);
      }
    }
    await new Promise((r) => setTimeout(r, 250)); // 温和限速，避免被服务商判为滥用
  }

  const cands = await fetchCandidates();
  const candFlagged = [];
  for (const c of cands) {
    const msg = String(c.msg || '').trim();
    if (!msg) continue;
    try {
      const res = await judge(provider, `${c.nickname || ''}：${msg}`);
      if (res.risk >= 0.6) candFlagged.push({ ...c, ...res });
    } catch { /* 单条失败不阻塞整体 */ }
  }

  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
  log(`完成：检查 ${posts.length} 条，标记 ${flagged.length} 条，${isDry ? '待隐藏' : '已隐藏'} ${hidden.length} 条，失败 ${failed} 次`);

  const rows = hidden.map((x) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">#${x.id}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(x.nick)} → ${esc(x.target)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(String(x.msg).slice(0, 80))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#c00">${Math.round(x.risk * 100)}%</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(x.reason)}</td>
    </tr>`).join('');

  const candRows = candFlagged.map((x) => `
    <tr>
      <td style="padding:8px;border-bottom:1px solid #eee">#${x.id}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${x.kind === 'xiaohua' ? '校花' : '校草'}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(x.nickname)}</td>
      <td style="padding:8px;border-bottom:1px solid #eee">${esc(String(x.msg).slice(0, 60))}</td>
      <td style="padding:8px;border-bottom:1px solid #eee;color:#c00">${Math.round(x.risk * 100)}%</td>
    </tr>`).join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Microsoft YaHei,sans-serif;max-width:720px;margin:0 auto;color:#3a0a1a">
    <h2 style="margin:0 0 6px">表白墙内容巡检报告</h2>
    <div style="color:#8a5a68;font-size:13px;margin-bottom:16px">${now} · 服务商 ${esc(provider.name)} · ${isDry ? '演练模式（未隐藏）' : '风险阈值 ' + THRESHOLD}</div>
    <div style="display:flex;gap:12px;margin-bottom:18px">
      <div style="flex:1;background:#fff5f7;border:1px solid #ffd7e0;border-radius:12px;padding:12px">
        <div style="font-size:24px;font-weight:800;color:#c4002a">${hidden.length}</div>
        <div style="font-size:12px;color:#8a5a68">${isDry ? '待隐藏' : '已自动隐藏'}</div>
      </div>
      <div style="flex:1;background:#fff9f0;border:1px solid #ffe8d6;border-radius:12px;padding:12px">
        <div style="font-size:24px;font-weight:800;color:#e8590c">${flagged.length - hidden.length}</div>
        <div style="font-size:12px;color:#8a5a68">需人工看一眼</div>
      </div>
      <div style="flex:1;background:#f6f8fa;border:1px solid #e5e9ef;border-radius:12px;padding:12px">
        <div style="font-size:24px;font-weight:800;color:#3a0a1a">${posts.length}</div>
        <div style="font-size:12px;color:#8a5a68">本次检查</div>
      </div>
    </div>
    ${hidden.length ? `<h3 style="font-size:15px">已隐藏</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="text-align:left;color:#8a5a68"><th style="padding:8px">ID</th><th style="padding:8px">谁写给谁</th><th style="padding:8px">内容</th><th style="padding:8px">风险</th><th style="padding:8px">理由</th></tr>
      ${rows}
    </table>` : '<p style="color:#0f9d63">本次没有达到隐藏阈值的内容。</p>'}
    ${candFlagged.length ? `<h3 style="font-size:15px;margin-top:22px">照片墙里也可疑（未自动处理，请人工确认）</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="text-align:left;color:#8a5a68"><th style="padding:8px">ID</th><th style="padding:8px">墙</th><th style="padding:8px">昵称</th><th style="padding:8px">文案</th><th style="padding:8px">风险</th></tr>
      ${candRows}
    </table>` : ''}
    <p style="color:#8a5a68;font-size:12px;margin-top:22px;line-height:1.7">
      隐藏是可撤销的（后台「内容」页可恢复可见）。如果你觉得误判偏多，把阈值调高到 0.8 以上。<br>
      本条为自动发送，无需回复。
    </p>
  </div>`;

  await sendMail(
    `[表白墙巡检] ${isDry ? '待隐藏' : '已隐藏'} ${hidden.length} 条 · 需人工 ${flagged.length - hidden.length} 条`,
    html,
  );

  // 让人在 Actions 页面也能一眼看到结论
  console.log('\n===== 摘要 =====');
  console.log(`检查 ${posts.length}｜标记 ${flagged.length}｜${isDry ? '待隐藏' : '已隐藏'} ${hidden.length}｜失败 ${failed}`);
  if (hidden.length) console.log('已处理 ID：' + hidden.map((x) => x.id).join(', '));
})().catch((e) => {
  console.error('巡检失败：' + e.message);
  process.exit(1);
});
