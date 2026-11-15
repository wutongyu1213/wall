// Supabase Edge Function: wall-ai
// ---------------------------------------------------------------------------
// 目的：把 AI 审核的密钥从浏览器挪到服务端。
//       后台「AI 审核」面板从此不用填 Base URL / Model / Key，
//       管理员登录后点一下就能扫——前端永远不接触密钥。
//
// 为什么必须这样做：
//   本站是公开仓库 + 纯静态托管。密钥若写进 ai-review-panel.js，
//   任何人按 F12 就能拿走，然后刷爆额度。这是没有折中余地的。
//
// 调用：POST /functions/v1/wall-ai
//   { admin:"<管理密码>", ping:true }                  → 探测是否已配置
//   { admin:"<管理密码>", text:"..." }                 → 单条
//   { admin:"<管理密码>", texts:["...","..."] }        → 批量（最多 20 条）
//
// 返回：
//   ping   → { ok:true, configured:true, model:"agnes-3.0-flash" }
//   扫描   → { ok:true, configured:true, model:"…", results:[{risk,cat,reason}] }
//   失败   → { ok:false, error:"bad_password" | "ai_key_missing" | … }
//
// 环境变量（Supabase Dashboard → Edge Functions → Secrets）：
//   AI_API_KEY   必填。AI 服务商密钥
//   ADMIN_PWD    必填。与 wall-admin 同一个管理密码（防止外人白嫖额度）
//   AI_BASE_URL  可选。默认 https://apihub.agnes-ai.com/v1
//   AI_MODEL     可选。默认 agnes-3.0-flash
// ---------------------------------------------------------------------------

const AI_KEY = Deno.env.get("AI_API_KEY") ?? "";
const AI_BASE = (Deno.env.get("AI_BASE_URL") ?? "https://apihub.agnes-ai.com/v1").replace(/\/+$/, "");
const AI_MODEL = Deno.env.get("AI_MODEL") ?? "agnes-3.0-flash";
const ADMIN_PWD = Deno.env.get("ADMIN_PWD") ?? "";

const MAX_TEXTS = 20;   // 单次最多审 20 条，防一次请求跑太久
const MAX_LEN = 500;    // 单条截断长度
const TIMEOUT_MS = 30000;

/* 与 wall-admin / wall-photo-sign 同款 CORS：只反射白名单内的 Origin */
const ALLOWED_ORIGINS = new Set([
  "https://wutongyu1213.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
]);
function cors(origin: string | null): Record<string, string> {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json",
    "Vary": "Origin",
  };
  if (origin && ALLOWED_ORIGINS.has(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}
function json(obj: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(obj), { status, headers: cors(origin) });
}

/* 审核策略：与 ai-review.mjs / ai-review-panel.js 保持同一份。
   关键点：年级、班级、单字或叠字称呼是表白墙的固定格式，不算隐私。 */
const SYS_PROMPT =
  "你是校园表白墙的内容审核助手，判断这段文本是否需要在校园公开空间隐藏。" +
  "注意：本产品的固定格式就是「某人对 X年级Y班 某某同学说」，" +
  "年级、班级、单字或叠字称呼（如「李同学」「小雨」）属于功能本身，不算泄露隐私，不要因此判违规。" +
  "只在出现以下情况时判高风险：" +
  "① 完整姓名（姓与名齐全）、学号、手机号、微信/QQ/二维码、住址等能直接定位到具体个人的信息；" +
  "② 人身攻击、辱骂、嘲笑外貌或身体缺陷；" +
  "③ 性暗示、低俗内容；" +
  "④ 索要联系方式、诱导线下单独见面；" +
  "⑤ 自伤、自杀倾向；" +
  "⑥ 诈骗、广告、引流。" +
  "正常的喜欢、表白、鼓励、玩笑、谐音梗、网络流行语都应判低风险（0.2 以下）。" +
  "先判断属于哪一类，再给风险分。只输出 JSON：" +
  '{"cat":"none | pii(完整姓名/学号/住址/家庭情况) | abuse(攻击辱骂) | sexual(性暗示) | contact(手机号微信QQ或索要联系方式) | selfharm(自伤) | spam(广告诈骗)",' +
  '"risk":0到1的小数,"reason":"不超过20字的中文理由"}';

const CATS = ["none", "pii", "abuse", "sexual", "contact", "selfharm", "spam"];

async function judgeOne(text: string): Promise<Record<string, unknown>> {
  const ctl = new AbortController();
  const tid = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${AI_BASE}/chat/completions`, {
      method: "POST",
      signal: ctl.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${AI_KEY}` },
      body: JSON.stringify({
        model: AI_MODEL,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: "system", content: SYS_PROMPT },
          { role: "user", content: "内容：" + text },
        ],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`HTTP ${r.status} ${t.slice(0, 80)}`);
    }
    const data = await r.json();
    const msg = (((data || {}).choices || [{}])[0] || {}).message || {};
    let content = msg.content || msg.reasoning_content || "";
    const m = content.match(/\{[\s\S]*\}/);
    if (m) content = m[0];
    const obj = JSON.parse(content);

    let risk = Number(obj.risk);
    if (!isFinite(risk)) risk = 0;
    let cat = String(obj.cat || "none").toLowerCase().trim();
    if (!CATS.includes(cat)) cat = "none";

    return {
      risk: Math.max(0, Math.min(1, risk)),
      cat,
      reason: String(obj.reason || "").slice(0, 40),
    };
  } finally {
    clearTimeout(tid);
  }
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, origin);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_json" }, 400, origin);
  }

  const configured = !!(AI_KEY && ADMIN_PWD);

  /* 鉴权：没配 ADMIN_PWD 也一律拒绝，避免函数被当成公开代理刷额度 */
  if (!ADMIN_PWD || String(body.admin ?? "") !== ADMIN_PWD) {
    return json({ ok: false, error: "bad_password" }, 401, origin);
  }

  if (body.ping) {
    return json({ ok: true, configured, model: AI_MODEL, base: AI_BASE }, 200, origin);
  }

  if (!AI_KEY) {
    return json(
      {
        ok: false,
        error: "ai_key_missing",
        hint: "在 Supabase → Edge Functions → Secrets 添加 AI_API_KEY",
      },
      503,
      origin,
    );
  }

  let texts: string[] = [];
  if (Array.isArray(body.texts)) {
    texts = body.texts as string[];
  } else if (typeof body.text === "string") {
    texts = [body.text];
  }
  texts = texts
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.slice(0, MAX_LEN))
    .slice(0, MAX_TEXTS);

  if (!texts.length) return json({ ok: false, error: "no_text" }, 400, origin);

  /* 串行调用：该网关只允许 1~2 并发，并发第 3 个会被挂住直到超时 */
  const results: Record<string, unknown>[] = [];
  for (const t of texts) {
    try {
      results.push(await judgeOne(t));
    } catch (e) {
      results.push({ error: String((e && (e as Error).message) || e).slice(0, 80) });
    }
  }

  return json({ ok: true, configured: true, model: AI_MODEL, results }, 200, origin);
});
