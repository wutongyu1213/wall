/* assets/pwa.js — PWA 安装助手
   1) 注册 Service Worker（离线外壳）
   2) 安卓 Chrome / Edge：beforeinstallprompt → 自动显示「安装 App」浮动按钮，点击弹出系统安装
   3) iPhone / iPad：点击按钮弹图文引导「Safari 分享 → 添加到主屏幕」
   4) 电脑浏览器：提示可用 Chrome/Edge 安装到桌面
   全站共享，所有页面 head 引用即可。 */
(function () {
  if (window.__pwaLoaded) return; window.__pwaLoaded = 1;

  /* ---- 1) Service Worker ---- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () { /* 静默 */ });
    });
  }

  /* ---- 平台识别 ---- */
  var ua = navigator.userAgent;
  var isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  if (isStandalone) return; /* 已安装状态下不显示按钮/引导 */

  /* ---- 2) 安卓安装 ---- */
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; showFab();
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    var f = document.getElementById('pwaFab'); if (f) f.remove();
    alert('✅ 安装成功！以后从主屏幕/桌面图标打开即可。');
  });

  /* ---- 浮动安装按钮 ---- */
  function showFab() {
    if (document.getElementById('pwaFab')) return;
    var b = document.createElement('div');
    b.id = 'pwaFab';
    b.style.cssText = 'position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99900;' +
      'display:flex;align-items:center;gap:8px;background:#2b1220;color:#fff;padding:9px 16px;' +
      'border-radius:999px;box-shadow:0 6px 20px rgba(43,18,32,.35);font-size:14px;font-weight:700;cursor:pointer;' +
      'transition:transform .15s;';
    b.innerHTML = '📲 <span>安装 App</span>';
    b.onclick = function () {
      if (deferred) { deferred.prompt(); return; }
      if (isIOS) { showIosGuide(); return; }
      showDesktopGuide();
    };
    document.body.appendChild(b);
    /* 3 秒后淡入 */
    b.style.opacity = '0'; requestAnimationFrame(function () { b.style.transition = 'opacity .4s'; b.style.opacity = '1'; });
  }

  /* ---- 3) iOS 图文引导 ---- */
  function showIosGuide() {
    var ov = document.createElement('div');
    ov.id = 'pwaOv';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(20,8,14,.72);display:flex;' +
      'align-items:flex-end;justify-content:center;';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:520px;' +
      'padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box;';
    card.innerHTML =
      '<div style="font-size:16px;font-weight:800;color:#c4002a;margin-bottom:12px;text-align:center">把表白墙装到主屏幕 📲</div>' +
      '<div style="display:flex;flex-direction:column;gap:10px">' +
      guide('1', '点 Safari 底部 <b>「分享」</b>按钮 <span style="font-size:22px">⬆️</span>') +
      guide('2', '下滑找到并点 <b>「添加到主屏幕」</b> <span style="font-size:20px">⊞</span>') +
      guide('3', '点右上角 <b>「添加」</b>，主屏幕就出现表白墙图标了 ✅') +
      '</div>' +
      '<div style="text-align:center;margin-top:14px">' +
      '<button id="pwaOvOk" style="background:#e0498f;color:#fff;border:0;border-radius:999px;padding:11px 40px;font-size:15px;font-weight:700">知道了</button>' +
      '</div>';
    ov.appendChild(card); document.body.appendChild(ov);
    document.getElementById('pwaOvOk').onclick = function () { ov.remove(); };
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
  }
  function guide(n, txt) {
    return '<div style="display:flex;align-items:center;gap:10px;background:#fff5f9;border:1px solid #ffdbe8;' +
      'border-radius:12px;padding:10px 12px"><span style="flex:none;width:26px;height:26px;border-radius:50%;' +
      'background:#e0498f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">' +
      n + '</span><span style="font-size:14px;color:#5a2b3d;line-height:1.5">' + txt + '</span></div>';
  }

  /* ---- 4) 电脑端引导 ---- */
  function showDesktopGuide() {
    alert('💻 电脑上安装：\n用 Chrome / Edge 打开本页面 → 点地址栏右侧的「安装」图标（或 ⋮ 菜单→ 安装网页应用）→ 桌面/开始菜单即生成 App 图标。');
  }

  /* 非安装态的默认入口：iOS 与未知浏览器也给个轻提示（首次访问 20 秒后显示） */
  if (isIOS) { setTimeout(showFab, 2000); }
})();
