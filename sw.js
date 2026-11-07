/* sw.js — 校园表白墙 PWA 离线外壳缓存 v1
   策略：页面导航 network-first（缓存兜底）；静态资源 stale-while-revalidate；
   Supabase REST/Edge/Storage 与跨域 CDN 一律不缓存（数据必须实时）。 */
const CACHE = 'wall-shell-v9';
/* P2-2：manifest-admin.json 实际是 404（走 data:URI 方案），预缓存它会让 addAll 整体 reject → SW 永不激活；已移除
   P2-audit：后台 admin.html 是访客侧不该下发的管理页，从预缓存移除；./sw.js 自身不纳入普通资源缓存 */
const CORE = [
  './', './index.html', './love-wall.html', './xiaohua-wall.html', './xiaocao-wall.html',
  './guide.html', './apk-guide.html',
  './manifest.json', './icon-48.png', './icon-192.png',
  './wall-common.js',
  './assets/supabase.js', './assets/device-fp.js', './assets/ai-review.js', './assets/bgm.js',
  './assets/announce.js', './assets/qrcode.js', './assets/pwa.js'
];
self.addEventListener('install', function (e) {
  /* P2-2：逐个容错缓存，单个资源 404/失败不再阻塞 Service Worker 激活 */
  e.waitUntil((async function () {
    var c = await caches.open(CACHE);
    await Promise.all(CORE.map(function (u) { return c.add(u).catch(function () {}); }));
    return self.skipWaiting();
  })());
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function cacheable(url) {
  try {
    const u = new URL(url);
    if (u.origin !== self.location.origin) return false;
    if (u.pathname.indexOf('/rest/') === 0 || u.pathname.indexOf('/functions/') === 0 || u.pathname.indexOf('/storage/') === 0) return false;
    if (/\.(jpg|jpeg|png|webp|mp3|mp4)(\?.*)?$/i.test(u.pathname)) return false; // 照片/音频体积大，不缓存
    return true;
  } catch (err) { return false; }
}
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET' || !cacheable(req.url)) return;
  if (req.mode === 'navigate') {
    /* 导航：network-first + 500ms 超时兜底缓存。
       新部署的 HTML 优先拿网络版（避免旧缓存与新数据混跑）；
       但校园网经常要等好几秒，所以最多等 500ms —— 超时先用缓存渲染，
       网络响应回来后仍然写进缓存，下次打开就是新的。
       注意：注释里写了超时、代码里却没有，是之前留下的坑，这里补上。 */
    e.respondWith((async function () {
      const c = await caches.open(CACHE);
      const cached = await caches.match(req);
      const netP = fetch(req).then(function (res) {
        if (res && res.ok) c.put(req, res.clone()).catch(function () {});
        return res;
      });
      netP.catch(function () {});           // 超时后网络仍可能失败，避免未处理拒绝

      if (!cached) {
        try { return await netP; } catch (err) {
          return new Response('<!doctype html><meta charset="utf-8"><title>离线</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>当前离线</h1><p>断网中，无法打开页面。恢复网络后重试。</p></body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }
      }

      const winner = await Promise.race([
        netP.catch(function () { return null; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 500); }),
      ]);
      return winner || cached;
    })());
    return;
  }
  e.respondWith(caches.match(req).then(function (cached) {
    const net = fetch(req).then(function (res) {
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
      return res;
    }).catch(function () { return cached; });
    return cached || net;
  }));
});
