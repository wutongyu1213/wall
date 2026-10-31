/* assets/pwa.js v2 — 全品牌智能安装助手
   覆盖：微信 / iOS Safari / Chrome / Edge / 三星 / OPPO / realme / vivo / iQOO /
   小米 / Redmi / 华为 / 荣耀 / 鸿蒙 / UC / QQ / 夸克 / 其他安卓浏览器 / 桌面
   苹果保持老方案（Safari 分享→添加到主屏幕）。
   国产定制浏览器只能"菜单→添加到桌面"（带地址栏，属系统限制），最终解法指向 PWA Builder 生成 APK。 */
(function(){
  if(window.__pwaLoaded)return;window.__pwaLoaded=1;
  /* 1) Service Worker */
  if('serviceWorker' in navigator && location.protocol==='https:'){
    window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){});});
  }
  /* 2) 全品牌环境识别（优先级：已装→微信→原生PWA→iOS→安卓品牌→其他） */
  var ua=navigator.userAgent;
  function getEnv(){
    if(/micromessenger/i.test(ua))return{t:'wechat',ios:/iphone|ipad/i.test(ua)};
    if(/iphone|ipad|ipod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))return{t:'ios'};
    if(/oppo|coloros|realme|rmx/i.test(ua))return{t:'oppo'};
    if(/vivo|originos|funtouch/i.test(ua))return{t:'vivo'};
    if(/xiaomi|redmi|mi [0-9]|miui/i.test(ua))return{t:'xiaomi'};
    if(/huawei|harmonyos|honor/i.test(ua))return{t:'huawei'};
    if(/samsung|sm-[a-z0-9]+/i.test(ua))return{t:'samsung'};
    if(/chrome|edga|edge/i.test(ua)&&!/qqbrowser|ucbrowser|quark/i.test(ua))return{t:'pwa'};
    return{t:'other'};
  }
  var env=getEnv();
  var isStandalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
  if(isStandalone)return;

  /* 3) 原生 PWA 安装（仅 pwa 环境触发） */
  var deferred=null;
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;showFab();});
  window.addEventListener('appinstalled',function(){deferred=null;var f=document.getElementById('pwaFab');if(f)f.remove();toast('✅ 安装成功！从桌面图标打开即可。');});

  /* 4) 浮动按钮 */
  function showFab(){
    if(document.getElementById('pwaFab'))return;
    var b=document.createElement('div');b.id='pwaFab';
    b.style.cssText='position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99900;display:flex;align-items:center;gap:8px;background:#2b1220;color:#fff;padding:9px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(43,18,32,.35);font-size:14px;font-weight:700;cursor:pointer;transition:transform .15s;';
    b.innerHTML='📲 <span>安装「二外圈」</span>';
    b.onclick=onFab;document.body.appendChild(b);
    b.style.opacity='0';requestAnimationFrame(function(){b.style.transition='opacity .4s';b.style.opacity='1';});
  }
  function onFab(){
    if(deferred){deferred.prompt();return;}
    switch(env.t){
      case'wechat':showWeChat();break;
      case'ios':showIos();break;
      case'samsung':case'oppo':case'realme':case'vivo':case'xiaomi':case'huawei':showAndroid();break;
      default:showDesktop();break;
    }
  }

  /* 5) 图文弹窗 */
  function popup(title,html){
    var ov=document.createElement('div');ov.id='pwaOv';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(20,8,14,.72);display:flex;align-items:flex-end;justify-content:center;';
    var card=document.createElement('div');
    card.style.cssText='background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:520px;padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box;';
    card.innerHTML='<div style="font-size:16px;font-weight:800;color:#c4002a;margin-bottom:12px;text-align:center">'+title+'</div>'
      +'<div style="display:flex;flex-direction:column;gap:10px">'+html+'</div>'
      +'<div style="text-align:center;margin-top:14px"><button id="pwaOvOk" style="background:#e0498f;color:#fff;border:0;border-radius:999px;padding:11px 40px;font-size:15px;font-weight:700">知道了</button></div>';
    ov.appendChild(card);document.body.appendChild(ov);
    document.getElementById('pwaOvOk').onclick=function(){ov.remove();};
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
  }
  function guide(n,txt){return '<div style="display:flex;align-items:center;gap:10px;background:#fff5f9;border:1px solid #ffdbe8;border-radius:12px;padding:10px 12px"><span style="flex:none;width:26px;height:26px;border-radius:50%;background:#e0498f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">'+n+'</span><span style="font-size:14px;color:#5a2b3d;line-height:1.5">'+txt+'</span></div>';}
  function note(txt){return '<div style="background:#fff6e6;border:1px solid #f2d9a8;color:#7a5200;border-radius:10px;padding:9px 11px;font-size:12.5px;line-height:1.6">'+txt+'</div>';}

  /* 6) 微信 */
  function showWeChat(){
    if(env.ios){
      popup('在微信里把二外圈装到主屏幕 📲',
        note('<b>iOS 微信</b>无法直接生成桌面图标（苹果限制），需借用 Safari：')+
        guide('1','点微信右上角 <b>「⋯」→「复制链接」</b>')+
        guide('2','切到 <b>Safari</b> 粘贴并打开本页')+
        guide('3','Safari 点 <b>「分享 ⬆️」→「添加到主屏幕」→「添加」</b>')+
        guide('4','主屏幕出现校徽图标，点开全屏 ✅'));
    }else{
      popup('在微信里把二外圈加到桌面 📲',
        guide('1','点微信右上角 <b>「⋯」→「复制链接」</b>')+
        guide('2','切到手机浏览器粘贴打开'+(env.t==='wechat'?'':''))+
        guide('3','浏览器菜单 →「添加到桌面」')
        +note('<b>说明</b>：安卓微信生成的是网页快捷方式。想要<b>独立全屏 App</b>，最终解法是用 PWA Builder（pwabuilder.com）生成 APK 安装。'));
    }
  }

  /* 7) iOS（苹果老方案） */
  function showIos(){
    popup('把二外圈装到主屏幕 📲',
      guide('1','点 Safari 底部 <b>「分享」</b>按钮 ⬆️')+
      guide('2','下滑找到并点 <b>「添加到主屏幕」</b> ⊞')+
      guide('3','点右上角 <b>「添加」</b>，主屏幕就出现校徽图标了 ✅')+
      note('iOS 无法生成独立 App，这是苹果的限制；主屏幕图标点开是全屏的，体验和 App 基本一致。'));
  }

  /* 8) 安卓品牌（三星/OPPO/realme/vivo/小米/华为/荣耀/其他） */
  function showAndroid(){
    var nameMap={samsung:'三星',oppo:'OPPO/realme',realme:'OPPO/realme',vivo:'vivo/iQOO',xiaomi:'小米/Redmi',huawei:'华为/荣耀/鸿蒙'};
    var nm=nameMap[env.t]||'手机浏览器';
    var isPwa=env.t==='samsung'; /* 三星浏览器支持标准 PWA */
    var steps=guide('1','点浏览器 <b>「≡ / …」菜单</b>（右上角或底部）')+
      guide('2','选 <b>「添加到桌面」/「创建桌面图标」/「添加到主屏幕」</b>')+
      guide('3','允许后桌面生成图标'+(isPwa?'（三星可生成独立全屏 App）':''));
    var extra=isPwa?'':note('<b>说明</b>：'+nm+' 生成的是网页快捷方式（点开可能带地址栏，属系统限制）。想要<b>独立全屏 App 图标</b>，最终解法是用 PWA Builder（pwabuilder.com）生成 APK 安装，需管理员协助。');
    popup('把二外圈装到桌面（'+nm+'）📲',steps+extra);
  }

  /* 9) 电脑桌面 */
  function showDesktop(){
    popup('💻 电脑上安装「二外圈」',
      guide('1','用 <b>Chrome / Edge</b> 打开本页面')+
      guide('2','点地址栏右侧的 <b>「安装」</b> 图标（或 ⋮ 菜单 → 安装网页应用）')+
      guide('3','桌面 / 开始菜单即生成独立 App 图标'));
  }

  function toast(t){var el=document.createElement('div');el.textContent=t;el.style.cssText='position:fixed;left:50%;bottom:calc(30px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#2b1220;color:#fff;padding:10px 18px;border-radius:999px;z-index:99999;font-size:14px;box-shadow:0 6px 20px rgba(43,18,32,.4)';document.body.appendChild(el);setTimeout(function(){el.remove();},3000);}

  /* 10) 默认入口：微信/iOS/安卓 → 3 秒后显示按钮；pwa 环境等 beforeinstallprompt */
  if(env.t!=='pwa'){setTimeout(showFab,2000);}
})();
