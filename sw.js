/* sw.js — 校园表白墙 PWA 离线外壳缓存 v1
   策略：页面导航 network-first（缓存兜底）；静态资源 stale-while-revalidate；
   Supabase REST/Edge/Storage 与跨域 CDN 一律不缓存（数据必须实时）。 */
const CACHE = 'wall-shell-v7';
/* P2-2：manifest-admin.json 实际是 404（走 data:URI 方案），预缓存它会让 addAll 整体 reject → SW 永不激活；已移除
   P2-audit：后台 admin.html 是访客侧不该下发的管理页，从预缓存移除；./sw.js 自身不纳入普通资源缓存 */
const CORE = [
  './', './index.html', './love-wall.html', './xiaohua-wall.html', './xiaocao-wall.html',
  './guide.html', './apk-guide.html',
  './manifest.json', './icon-192.png', './icon-512.png', './icon-apple-180.png',
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
    /* P2-3：导航改 network-first（~500ms 超时兜底缓存）——
       新部署的 HTML 立即生效，避免旧缓存与新数据/鉴权协议混跑导致白屏；
       网络不可用时回退到缓存，保持离线可用。 */
    e.respondWith((async function () {
      try {
        const res = await fetch(req);
        if (res && res.ok) {
          const copy = res.clone();
          const c = await caches.open(CACHE);
          c.put(req, copy).catch(function () {});
        }
        return res;
      } catch (err) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response('<!doctype html><meta charset="utf-8"><title>离线</title><body style="font-family:sans-serif;padding:40px;text-align:center"><h1>当前离线</h1><p>断网中，无法打开页面。恢复网络后重试。</p></body>', { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
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
