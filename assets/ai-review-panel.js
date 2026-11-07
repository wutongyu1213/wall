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
    '你是校园表白墙的内容审核助手。判断这段文本是否需要在校园公开空间隐藏。' +
    '重点看：人身攻击/辱骂/嘲讽同学、性暗示或低俗、泄露真实姓名加班级等可识别信息、' +
    '手机号/QQ/微信号等联系方式、诱导线下见面、自伤自杀倾向、诈骗或广告。' +
    '不要因为是表白、玩笑、谐音梗或网络流行语就判违规。' +
    '只输出 JSON，格式：{"risk":0到1的小数,"reason":"不超过20字的中文理由"}';

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
      '机器先过一遍，把可疑的挑出来由你决定。Key 只存在这台设备，不会下发给访客。</div>' +
      '<div style="display:grid;gap:8px;margin-bottom:10px">' +
      '<input id="aiBase" placeholder="接口地址 https://api.openai.com/v1" value="' + (conf.base || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '<input id="aiModel" placeholder="模型 gpt-4o-mini" value="' + (conf.model || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '<input id="aiKey" type="password" placeholder="API Key（只存本机）" value="' + (conf.key || '') + '" style="padding:11px 12px;border:1px solid rgba(196,0,42,.16);border-radius:12px;font-size:14px;background:#fff">' +
      '</div>' +
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
      '<span style="font-size:13px;color:#8a5a68">检查最近</span>' +
      '<input id="aiN" type="number" min="1" max="50" value="20" style="width:72px;padding:8px 10px;border:1px solid rgba(196,0,42,.16);border-radius:10px;font-size:14px;background:#fff">' +
      '<span style="font-size:13px;color:#8a5a68">条</span>' +
      '<label style="margin-left:auto;font-size:13px;color:#8a5a68;display:flex;align-items:center;gap:6px">' +
      '<input id="aiAuto" type="checkbox" style="width:auto">高风险自动隐藏</label>' +
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
        return { risk: Math.max(0, Math.min(1, risk)), reason: String(obj.reason || '').slice(0, 30) };
      } finally {
        if (tid) clearTimeout(tid);
      }
    }

    async function runScan() {
      var base = q('#aiBase').value.trim() || 'https://api.openai.com/v1';
      var model = q('#aiModel').value.trim() || 'gpt-4o-mini';
      var key = q('#aiKey').value.trim();
      var num = parseInt(q('#aiN').value || '20', 10);
      if (!num || num < 1) num = 20;
      if (num > 50) num = 50;
      var auto = q('#aiAuto').checked;

      if (!key) { log('请先填 API Key'); return; }
      if (typeof PWD === 'undefined' || !PWD) { log('请先在上方输入管理密码登录，再点检查'); return; }
      saveCfg({ base: base, model: model, key: key });

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
          r = await callAI(base, model, key,
            (p.nickname || '匿名') + ' 对 ' + (p.target_name || '') + '：' + p.love_msg);
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
            if (!confirm('确定隐藏 #' + pid + '？隐藏后前台不再显示。')) return;
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

        if (auto && r.risk >= 0.75) {
          try {
            var ar = await edge('hide', { id: p.id });
            if (ar && ar.ok) {
              btn.textContent = '已隐藏 ✓';
              btn.style.background = '#0f9d63';
              btn.disabled = true;
              hidden++;
            }
          } catch (e) {}
        }
      }

      log('完成：检查 ' + done + ' 条，已隐藏 ' + hidden + ' 条');
      try { if (typeof loadPosts === 'function') loadPosts(); } catch (e) {}
    }
  }

  fab.onclick = openPanel;
})();
