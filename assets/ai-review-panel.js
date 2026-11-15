/* ai-review-panel.js — 后台 AI 内容审核面板
   ------------------------------------------------------------------
   为什么独立成文件：
   1. 后台页面已经 47KB，再塞 9KB 内联脚本不利于维护；
   2. 独立文件可被浏览器缓存，二次打开不重复下载。

   安全取舍（必须说清）：
   纯静态站没有服务端可以安全保管密钥。所以 Key 只存在【管理员这台设备的
   localStorage】，绝不会随页面下发给任何访客。代价是换设备要重填。
   彻底做法是把审核挪到 Edge Function，Key 只放 Supabase Secret——
   那时前端连输入框都不需要。

   接口按 OpenAI 兼容格式（/chat/completions），换任何兼容服务商只改 Base URL。
*/
(function () {
  if (!/admin\.html/.test(location.pathname)) return;

  var LS_KEY = 'wallAiCfg';
  var SYS_PROMPT =
    '你是校园表白墙的内容审核助手，判断这段文本是否需要在校园公开空间隐藏。' +
    '注意：本产品的固定格式就是「某人对 X年级Y班 某某同学说」，' +
    '年级、班级、单字或叠字称呼（如「李同学」「小雨」）属于功能本身，不算泄露隐私，不要因此判违规。' +
    '只在出现以下情况时判高风险：' +
    '① 完整姓名（姓与名齐全）、学号、手机号、微信/QQ/二维码、住址等能直接定位到具体个人的信息；' +
    '② 人身攻击、辱骂、嘲笑外貌或身体缺陷；' +
    '③ 性暗示、低俗内容；' +
    '④ 索要联系方式、诱导线下单独见面；' +
    '⑤ 自伤、自杀倾向；' +
    '⑥ 诈骗、广告、引流。' +
    '正常的喜欢、表白、鼓励、玩笑、谐音梗、网络流行语都应判低风险（0.2 以下）。' +
    '先判断属于哪一类，再给风险分。只输出 JSON：' +
    '{"cat":"none | pii(完整姓名/学号/住址/家庭情况) | abuse(攻击辱骂) | sexual(性暗示) | contact(手机号微信QQ或索要联系方式) | selfharm(自伤) | spam(广告诈骗)",' +
    '"risk":0到1的小数,"reason":"不超过20字的中文理由"}';

  function loadCfg() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveCfg(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (e) {}
  }

  /* ---------------- 入口按钮 ---------------- */
  var fab = document.createElement('button');
  fab.type = 'button';
  fab.id = 'aiFab';
  fab.textContent = 'AI';
  fab.setAttribute('aria-label', 'AI 内容审核');
  fab.style.cssText =
    'position:fixed;right:16px;bottom:calc(84px + env(safe-area-inset-bottom,0px));z-index:9989;' +
    'width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.6);' +
    'background:linear-gradient(150deg,#8f7bff,#c4002a);color:#fff;font-size:14px;font-weight:800;' +
    'display:flex;align-items:center;justify-content:center;letter-spacing:.5px;' +
    'box-shadow:0 10px 28px rgba(92,32,58,.28), inset 0 1px 0 rgba(255,255,255,.5);cursor:pointer;';
  document.body.appendChild(fab);

  var overlay = null;
  function closePanel() {
    if (overlay) { overlay.remove(); overlay = null; }
  }

  function openPanel() {
    if (overlay) return;
    var conf = loadCfg();

    overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9996;display:flex;align-items:flex-end;justify-content:center;' +
      'background:rgba(28,8,16,.44);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);';
    overlay.onclick = function (e) { if (e.target === overlay) closePanel(); };

    var card = document.createElement('div');
    card.style.cssText =
      'width:100%;max-width:620px;background:rgba(255,255,255,.95);border-radius:26px 26px 0 0;' +
      'padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px));box-sizing:border-box;' +
      'max-height:88vh;overflow:auto;box-shadow:0 -12px 40px rgba(92,32,58,.24), inset 0 1px 0 #fff;';
    card.innerHTML =
      '<div style="font-size:18px;font-weight:800;color:#c4002a;margin-bottom:4px">AI 内容审核</div>' +
      '<div style="font-size:12px;color:#8a5a68;line-height:1.7;margin-bottom:14px">' +
      '机器先过一遍，把可疑的挑出来由你<b>手动</b>决定是否隐藏。<b style="color:#c4002a">隐藏后前台不再显示，且当前无法恢复。</b>Key 只存本机 localStorage，不会随页面下发给访客。</div>' +
      '<div id="aiServerTip" style="display:none;font-size:12.5px;color:#0f7a3d;background:#eefaf1;border:1px solid #b6e4c6;border-radius:12px;padding:10px 12px;margin-bottom:10px;line-height:1.7"></div>' +
      '<div id="aiCfgBox" style="display:grid;gap:8px;margin-bottom:10px">' +
      '<input id="aiBase" placeholder="接口地址 https://apihub.agnes-ai.com/v1" value="' + (conf.base || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '<input id="aiModel" placeholder="模型 agnes-3.0-flash" value="' + (conf.model || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '<input id="aiKey" type="password" placeholder="API Key（只存本机）" value="' + (conf.key || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<span style="font-size:13px;color:#8a5a68">检查最近</span>' +
      '<input id="aiN" type="number" min="1" max="50" value="20" style="width:72px;padding:8px 10px;border:1px solid rgba(196,0,42,.16);border-radius:10px;font-size:14px;background:#fff">' +
      '<span style="font-size:13px;color:#8a5a68">条</span>' +
      '</div>' +
      '<button id="aiRun" style="width:100%;padding:14px;border:0;border-radius:999px;font-size:15px;font-weight:800;background:linear-gradient(135deg,#8f7bff,#c4002a);color:#fff">开始检查</button>' +
      '<div id="aiProg" style="margin-top:10px;font-size:13px;color:#8a5a68;min-height:18px"></div>' +
      '<div id="aiList" style="margin-top:6px;display:grid;gap:10px"></div>' +
      '<button id="aiClose" style="width:100%;margin-top:14px;padding:11px;border:1px solid rgba(196,0,42,.18);border-radius:999px;background:rgba(255,255,255,.7);color:#8a5a68;font-size:14px">关闭</button>';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function q(sel) { return card.querySelector(sel); }
    function log(msg) { q('#aiProg').textContent = msg; }

    q('#aiClose').onclick = closePanel;
    q('#aiRun').onclick = runScan;

    /* ---------------- 服务端代理（wall-ai Edge） ----------------
       目的：密钥放 Supabase Secrets，浏览器里没有。
       探测到已配置 → 隐藏输入框，点一下就能扫；没部署/没配 → 退回本机 Key 手动模式。
       注意：这里必须带 admin 密码，否则任何人都能拿这个函数白嫖额度。 */
    var SERVER = null;

    function apiEndpoint() {
      var b = (typeof SUPA_URL !== 'undefined' && SUPA_URL) ? SUPA_URL : 'https://dpceuvqtwvhoipxhozxz.supabase.co';
      var k = (typeof ANON_KEY !== 'undefined' && ANON_KEY) ? ANON_KEY : '';
      return { url: b.replace(/\/+$/, '') + '/functions/v1/wall-ai', key: k };
    }

    async function probeServer() {
      var tip = q('#aiServerTip'), box = q('#aiCfgBox');
      if (typeof PWD === 'undefined' || !PWD) return;   // 未登录不探
      var ep = apiEndpoint();
      try {
        var r = await fetch(ep.url, {
          method: 'POST',
          headers: { apikey: ep.key, Authorization: 'Bearer ' + ep.key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin: PWD, ping: true }),
        });
        if (r.status === 404) return;                   // 函数未部署 → 保持手动模式
        var j = null;
        try { j = await r.json(); } catch (e) { return; }
        if (!j || !j.ok) return;                        // 密码不符等 → 保持手动

        SERVER = j;
        if (j.configured) {
          tip.style.display = 'block';
          tip.style.background = '#eefaf1';
          tip.style.borderColor = '#b6e4c6';
          tip.style.color = '#0f7a3d';
          tip.innerHTML = '✅ <b>已由服务端配置好</b>，不用填任何东西，直接点下面的按钮。<br>' +
            '模型：' + escHtml(j.model || '—') + ' · 密钥存在 Supabase，浏览器里没有。';
          box.style.display = 'none';
          var rb = q('#aiRun');
          if (rb) rb.textContent = '开始检查（已配置）';
        } else {
          tip.style.display = 'block';
          tip.style.background = '#fff6e6';
          tip.style.borderColor = '#f2d9a8';
          tip.style.color = '#8a5a1a';
          tip.innerHTML = '⚠️ 服务端已连通，但<b>还没配 AI_API_KEY</b>。<br>' +
            '可以让管理员去 Supabase → Edge Functions → Secrets 加一条，或在下面临时填一个 Key。';
        }
      } catch (e) { /* 网络异常 → 保持手动模式，不打扰用户 */ }
    }

    function escHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
      });
    }

    async function callServer(text) {
      var ep = apiEndpoint();
      var r = await fetch(ep.url, {
        method: 'POST',
        headers: { apikey: ep.key, Authorization: 'Bearer ' + ep.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin: PWD, texts: [text] }),
      });
      var j = null;
      try { j = await r.json(); } catch (e) { /* ignore */ }
      if (!r.ok) throw new Error('HTTP ' + r.status + (j && j.error ? ' ' + j.error : ''));
      if (!j || !j.ok) throw new Error((j && j.error) || '服务端错误');
      var x = (j.results || [])[0];
      if (!x || x.error) throw new Error((x && x.error) || '空结果');
      return x;
    }

    probeServer();

    /* 单条调用：超时 20 秒，异常向上抛由调用方显示 */
    async function callAI(base, model, key, text) {
      var url = base.replace(/\/+$/, '') + '/chat/completions';
      var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
      var tid = ctl ? setTimeout(function () { ctl.abort(); }, 20000) : null;
      try {
        var resp = await fetch(url, {
          method: 'POST',
          signal: ctl ? ctl.signal : undefined,
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
          body: JSON.stringify({
            model: model,
            temperature: 0,
            max_tokens: 120,
            messages: [
              { role: 'system', content: SYS_PROMPT },
              { role: 'user', content: '内容：' + text }
            ]
          })
        });
        if (!resp.ok) {
          var t = await resp.text();
          throw new Error('HTTP ' + resp.status + ' ' + t.slice(0, 80));
        }
        var data = await resp.json();
        var content = (((data || {}).choices || [{}])[0].message || {}).content || '';
        var m = content.match(/\{[\s\S]*\}/);
        if (m) content = m[0];
        var obj = JSON.parse(content);
        var risk = Number(obj.risk);
        if (!isFinite(risk)) risk = 0;
        var CATS = ['none', 'pii', 'abuse', 'sexual', 'contact', 'selfharm', 'spam'];
        var cat = String(obj.cat || 'none').toLowerCase().trim();
        if (CATS.indexOf(cat) < 0) cat = 'none';
        return { risk: Math.max(0, Math.min(1, risk)), cat: cat, reason: String(obj.reason || '').slice(0, 30) };
      } finally {
        if (tid) clearTimeout(tid);
      }
    }

    async function runScan() {
      var base = q('#aiBase').value.trim() || 'https://apihub.agnes-ai.com/v1';
      var model = q('#aiModel').value.trim() || 'agnes-3.0-flash';
      var key = q('#aiKey').value.trim();
      var num = parseInt(q('#aiN').value || '20', 10);
      if (!num || num < 1) num = 20;
      if (num > 50) num = 50;

      var useServer = !!(SERVER && SERVER.configured);
      if (!useServer && !key) { log('请先填 API Key（或让管理员在服务端配好）'); return; }
      if (typeof PWD === 'undefined' || !PWD) { log('请先在上方输入管理密码登录，再点检查'); return; }
      if (!useServer) saveCfg({ base: base, model: model, key: key });

      var listEl = q('#aiList');
      listEl.innerHTML = '';
      log('正在读取帖子…');

      var res;
      try { res = await edge('all_posts', {}); } catch (e) { log('读取失败：' + e.message); return; }
      if (!res || !res.ok) { log('读取失败：' + ((res && res.error) || '未知')); return; }

      var posts = (res.posts || []).filter(function (p) {
        return p && p.status === 'ok' && String(p.love_msg || '').trim();
      }).slice(0, num);

      if (!posts.length) { log('没有可检查的帖子'); return; }

      var done = 0, hidden = 0;
      for (var i = 0; i < posts.length; i++) {
        var p = posts[i];
        log('检查中 ' + (i + 1) + '/' + posts.length + '…');
        var r;
        try {
          var txt = (p.nickname || '匿名') + ' 对 ' + (p.target_name || '') + '：' + p.love_msg;
          r = useServer ? await callServer(txt) : await callAI(base, model, key, txt);
        } catch (e) {
          log('第 ' + (i + 1) + ' 条失败：' + e.message);
          continue;
        }
        done++;

        var level = r.risk >= 0.75 ? '高' : (r.risk >= 0.45 ? '中' : '低');
        var color = r.risk >= 0.75 ? '#c4002a' : (r.risk >= 0.45 ? '#e8590c' : '#0f9d63');
        var row = document.createElement('div');
        row.style.cssText = 'border:1px solid rgba(196,0,42,.12);border-radius:16px;padding:12px;background:rgba(255,255,255,.75)';

        var head = document.createElement('div');
        head.style.cssText = 'font-size:13px;font-weight:700;color:#3a0a1a';
        head.textContent = '#' + p.id + ' ' + (p.nickname || '匿名') + ' → ' + (p.target_name || '');

        var badge = document.createElement('span');
        badge.style.cssText = 'color:' + color + ';margin-left:6px';
        badge.textContent = '风险 ' + Math.round(r.risk * 100) + '%（' + level + '）';
        head.appendChild(badge);

        var body = document.createElement('div');
        body.style.cssText = 'font-size:12px;color:#8a5a68;margin:6px 0 8px;line-height:1.6';
        body.textContent = String(p.love_msg || '').slice(0, 60);

        var why = document.createElement('div');
        why.style.cssText = 'font-size:12px;color:#6b4a58';
        why.textContent = '理由：' + (r.reason || '—');

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '隐藏这条';
        btn.style.cssText = 'margin-top:8px;padding:8px 14px;border:0;border-radius:999px;background:#c4002a;color:#fff;font-size:13px;font-weight:700;cursor:pointer';
        btn.onclick = (function (pid, node) {
          return async function () {
            if (!confirm('确定隐藏 #' + pid + '？隐藏后前台不再显示，且当前无法恢复。')) return;
            node.disabled = true;
            node.textContent = '处理中…';
            var out = await edge('hide', { id: pid });
            if (out && out.ok) {
              node.textContent = '已隐藏 ✓';
              node.style.background = '#0f9d63';
              hidden++;
            } else {
              node.disabled = false;
              node.textContent = '失败，重试';
            }
          };
        })(p.id, btn);

        row.appendChild(head);
        row.appendChild(body);
        row.appendChild(why);
        row.appendChild(btn);
        listEl.appendChild(row);
      }

      log('完成：检查 ' + done + ' 条，已隐藏 ' + hidden + ' 条');
      try { if (typeof loadPosts === 'function') loadPosts(); } catch (e) {}
    }
  }

  fab.onclick = openPanel;
})();
