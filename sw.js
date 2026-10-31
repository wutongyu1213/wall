/* sw.js — 校园表白墙 PWA 离线外壳缓存 v1
   策略：页面导航 network-first（缓存兜底）；静态资源 stale-while-revalidate；
   Supabase REST/Edge/Storage 与跨域 CDN 一律不缓存（数据必须实时）。 */
const CACHE = 'wall-shell-v1';
const CORE = [
  './', './index.html', './love-wall.html', './xiaohua-wall.html', './xiaocao-wall.html', './admin.html',
  './manifest.json', './icon-192.png', './icon-512.png', './icon-apple-180.png',
  './wall-common.js',
  './assets/supabase.js', './assets/device-fp.js', './assets/ai-review.js', './assets/bgm.js',
  './assets/announce.js', './assets/qrcode.js', './assets/pwa.js', './sw.js'
];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
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
    e.respondWith(fetch(req).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req.url, copy); });
      return res;
    }).catch(function () {
      return caches.match(req.url).then(function (r) { return r || caches.match('./index.html'); });
    }));
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
