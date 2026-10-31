/* assets/pwa.js v4 — 安装助手（安卓=浏览器菜单→添加到桌面 / 苹果=主屏幕 / 微信=复制链接）
   设计：
   - 安卓所有机型（OPPO/ColorOS、realme、vivo/iQOO、小米/Redmi、华为/鸿蒙/荣耀、三星、UC、QQ、夸克）
     → 无条件显示「安装」按钮 → 弹图文引导"浏览器菜单 → 添加到桌面"（各品牌菜单位置不同步提示）
   - Chrome/Edge 安卓：若系统触发 beforeinstallprompt 则优先走原生安装（独立全屏 App）；未触发则兜底走菜单引导
   - iPhone/iPad → 老方案：Safari「分享 → 添加到主屏幕」
   - 微信内打开 → 复制链接到外部浏览器再安装
   - 电脑 → Chrome/Edge 安装到桌面
   全站共享，所有页面 head 引用。 */
(function(){
  if(window.__pwaLoaded)return;window.__pwaLoaded=1;
  /* 1) Service Worker（离线外壳） */
  if('serviceWorker' in navigator && location.protocol==='https:'){
    window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){});});
  }
  /* 2) 环境识别（内置浏览器 token 优先，避免 UA 含 Chrome 字样误判） */
  var ua=navigator.userAgent;
  function getEnv(){
    if(/micromessenger/i.test(ua))return{t:'wechat',ios:/iphone|ipad/i.test(ua)};
    if(/iphone|ipad|ipod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))return{t:'ios'};
    if(/oapp|oppo|coloros|realme|rmx|heytap/i.test(ua))return{t:'oppo',brand:'OPPO / ColorOS'};
    if(/vivo|iqoo|originos|funtouch/i.test(ua))return{t:'vivo',brand:'vivo / iQOO'};
    if(/xiaomi|redmi|miui|mi [0-9]|miui/i.test(ua))return{t:'xiaomi',brand:'小米 / Redmi'};
    if(/huawei|harmonyos|honor|hbbrowser|huaweibrowser/i.test(ua))return{t:'huawei',brand:'华为 / 荣耀 / 鸿蒙'};
    if(/samsung|sm-[a-z0-9]+/i.test(ua))return{t:'samsung',brand:'三星'};
    if(/qqbrowser/i.test(ua))return{t:'qq',brand:'QQ 浏览器'};
    if(/ucbrowser|ucweb|ubrowser/i.test(ua))return{t:'uc',brand:'UC 浏览器'};
    if(/quark/i.test(ua))return{t:'quark',brand:'夸克浏览器'};
    if(/chrome|edga|edge/i.test(ua))return{t:'pwa'};
    if(/android/i.test(ua))return{t:'android',brand:'安卓浏览器'};
    return{t:'desktop'};
  }
  var env=getEnv();
  var isStandalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
  if(isStandalone)return;

  /* 3) 原生 PWA 安装（Chrome/Edge 触发 beforeinstallprompt 时优先） */
  var deferred=null;
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;showFab();});
  window.addEventListener('appinstalled',function(){deferred=null;var f=document.getElementById('pwaFab');if(f)f.remove();toast('✅ 安装成功！从桌面图标打开即可。');});

  /* 4) 浮动按钮（文案：安装「二外圈」） */
  function showFab(){
    if(document.getElementById('pwaFab'))return;
    var b=document.createElement('div');b.id='pwaFab';
    b.style.cssText='position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99900;display:flex;align-items:center;gap:8px;background:#2b1220;color:#fff;padding:9px 16px;border-radius:999px;box-shadow:0 6px 20px rgba(43,18,32,.35);font-size:14px;font-weight:700;cursor:pointer;transition:transform .15s;';
    b.innerHTML='📲 <span>安装「二外圈」</span>';
    b.onclick=onFab;document.body.appendChild(b);
    b.style.opacity='0';requestAnimationFrame(function(){b.style.transition='opacity .4s';b.style.opacity='1';});
  }
  function onFab(){
    if(deferred){deferred.prompt();deferred=null;return;} /* 原生 PWA 优先 */
    if(env.t==='wechat')showWeChat();
    else if(env.t==='ios')showIos();
    else if(env.t==='desktop')showDesktop();
    else showAndroid();
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

  /* 各品牌菜单 → 添加到桌面 的按钮位置提示 */
  var MENU={
    oppo:'点右上角「≡ / ⋮」菜单，选「<b>添加到桌面</b> / <b>创建桌面图标</b>」',
    vivo:'点底部「工具 / ≡」菜单，选「<b>添加到桌面</b>」',
    xiaomi:'点右上角「⋮」菜单，选「<b>添加到主屏幕</b>」',
    huawei:'点右上角「⋯ / ⋮」菜单，选「<b>添加到桌面</b>」（部分机型为「创建快捷方式」）',
    samsung:'点右上角「⋮」菜单，选「<b>添加到主屏幕</b>」（三星浏览器多数能生成独立全屏图标）',
    qq:'点左上角「☰ / …」菜单 →「<b>设置 → 添加到主屏幕</b>」',
    uc:'点右上角「≡」菜单 →「<b>添加到桌面</b>」',
    quark:'点右上角「⋮ / …」菜单 →「<b>添加到桌面</b>」',
    android:'点浏览器菜单「⋮ / ≡ / …」→「<b>添加到桌面 / 主屏幕</b>」',
    pwa:'点地址栏右侧「⋮」→「<b>安装应用 / 添加到主屏幕</b>」'
  };
  function brandName(){return env.brand||(env.t==='pwa'?'浏览器':'浏览器');}

  /* 6) 安卓统一引导（所有安卓品牌：菜单 → 添加到桌面） */
  function showAndroid(){
    var key=(env.t==='pwa')?'pwa':env.t;
    var menuHint=MENU[key]||MENU.android;
    popup('把二外圈装到桌面（'+brandName()+'）📲',
      guide('1','点本页面左下角这个「📲 安装」或右上角浏览器菜单')+
      guide('2',menuHint)+
      guide('3','允许后桌面生成校徽图标，点开即用 ✅')+
      note('说明：这是「网页快捷方式」，点开可能带地址栏，属系统正常现象；图标就是校徽，用法和 App 一样。'));
  }

  /* 7) 微信（iOS 复制去 Safari；安卓 复制到浏览器加桌面） */
  function showWeChat(){
    if(env.ios){
      popup('在微信里把二外圈装到主屏幕 📲',
        note('<b>iOS 微信</b>无法直接生成桌面图标（苹果限制），需借用 Safari：')+
        guide('1','点微信右上角 <b>「⋯」→「复制链接」</b>')+
        guide('2','切到 <b>Safari</b> 粘贴并打开本页')+
        guide('3','Safari 点 <b>「分享 ⬆️」→「添加到主屏幕」→「添加」</b>')+
        guide('4','主屏幕出现校徽图标，点开全屏 ✅'));
    }else{
      popup('在微信里把二外圈装到桌面 📲',
        guide('1','点微信右上角 <b>「⋯」→「复制链接」</b>')+
        guide('2','点「…」旁边的 <b>「用浏览器打开」</b>（或切到手机浏览器粘贴打开）')+
        guide('3','在浏览器里点这个「📲 安装」按钮，按提示<b>菜单 → 添加到桌面</b>')+
        note('微信内无法直接生成桌面图标，需借助浏览器完成最后一步。'));
    }
  }

  /* 8) iOS（苹果老方案，不变） */
  function showIos(){
    popup('把二外圈装到主屏幕 📲',
      guide('1','点 Safari 底部 <b>「分享」</b>按钮 ⬆️')+
      guide('2','下滑找到并点 <b>「添加到主屏幕」</b> ⊞')+
      guide('3','点右上角 <b>「添加」</b>，主屏幕就出现校徽图标了 ✅')+
      note('iOS 无法生成独立 App，这是苹果的限制；主屏幕图标点开是全屏的，体验和 App 基本一致。'));
  }

  /* 9) 电脑桌面 */
  function showDesktop(){
    popup('💻 电脑上安装「二外圈」',
      guide('1','用 <b>Chrome / Edge</b> 打开本页面')+
      guide('2','点地址栏右侧的 <b>「安装」</b> 图标（或 ⋮ 菜单 → 安装网页应用）')+
      guide('3','桌面 / 开始菜单即生成独立 App 图标'));
  }

  function toast(t){var el=document.createElement('div');el.textContent=t;el.style.cssText='position:fixed;left:50%;bottom:calc(30px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#2b1220;color:#fff;padding:10px 18px;border-radius:999px;z-index:99999;font-size:14px;box-shadow:0 6px 20px rgba(43,18,32,.4)';document.body.appendChild(el);setTimeout(function(){el.remove();},3000);}

  /* 10) 默认入口：
      - 非 pwa 环境（微信/iOS/各安卓品牌）→ 3 秒后直接出按钮
      - pwa 环境（Chrome/Edge 安卓）→ 等 beforeinstallprompt；4 秒未触发则兜底出按钮（点按 MENU.pwa 引导） */
  if(env.t==='pwa'){setTimeout(function(){if(!deferred)showFab();},4000);}
  else setTimeout(showFab,2000);
})();
