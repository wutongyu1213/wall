/* assets/pwa.js v5 — 一键安装助手（好适配浏览器原生弹装 + 小白图文兜底）
   安卓：Chrome / Edge / 百度 / 三星 / QQ / 夸克 / UC → 能弹原生安装框就一键弹；弹不了给"菜单→添加到桌面"图文
        OPPO内置 / 华为 / 小米 / vivo → 推荐换 QQ 或百度浏览器（双路径：不换也能装）
   苹果：Safari 分享→添加到主屏幕（老方案）
   微信：复制链接→在浏览器中打开→再加桌面
   电脑：地址栏安装图标（其他浏览器先复制网址去 Chrome/Edge） */
(function(){
  if(window.__pwaLoaded)return;window.__pwaLoaded=1;
  if('serviceWorker' in navigator && location.protocol==='https:'){
    window.addEventListener('load',function(){navigator.serviceWorker.register('./sw.js').catch(function(){});});
  }
  var ua=navigator.userAgent;
  function getEnv(){
    if(/micromessenger/i.test(ua))return{t:'wechat',ios:/iphone|ipad/i.test(ua)};
    if(/iphone|ipad|ipod/i.test(ua)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1))return{t:'ios'};
    if(/oapp|oppo|coloros|realme|rmx|heytap|peam|pdrm|pcdm|pacm|paam/i.test(ua))return{t:'oppo',brand:'OPPO 自带浏览器',good:0};
    if(/vivo|iqoo|originos|funtouch/i.test(ua))return{t:'vivo',brand:'vivo 自带浏览器',good:0};
    if(/xiaomi|redmi|miui|mi [0-9]|_mi/i.test(ua))return{t:'xiaomi',brand:'小米自带浏览器',good:0};
    if(/huawei|harmonyos|honor|huaweibrowser|hbbrowser/i.test(ua))return{t:'huawei',brand:'华为自带浏览器',good:0};
    if(/samsung|sm-[a-z0-9]+/i.test(ua))return{t:'samsung',brand:'三星浏览器',good:1};
    if(/baidubrowser|baiduapp/i.test(ua))return{t:'baidu',brand:'百度浏览器',good:1};
    if(/qqbrowser|mqqbrowser/i.test(ua))return{t:'qq',brand:'QQ 浏览器',good:1};
    if(/ucbrowser|ucweb|ubrowser/i.test(ua))return{t:'uc',brand:'UC 浏览器',good:0};
    if(/quark/i.test(ua))return{t:'quark',brand:'夸克浏览器',good:0};
    if(/chrome|edga|edge/i.test(ua))return{t:'pwa',brand:'Chrome / Edge',good:1};
    if(/android/i.test(ua))return{t:'android',brand:'手机浏览器',good:0};
    return{t:'desktop',brand:'',good:0};
  }
  var env=getEnv();
  var isStandalone=(window.matchMedia&&window.matchMedia('(display-mode: standalone)').matches)||navigator.standalone;
  if(isStandalone)return;

  /* 原生一键安装：系统能弹就弹（不靠 UA 判断，浏览器自己报能力） */
  var deferred=null,prompted=false;
  window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();deferred=e;showFab();});
  window.addEventListener('appinstalled',function(){deferred=null;var f=document.getElementById('pwaFab');if(f)f.remove();toast('✅ 装好啦！去桌面找校徽图标');});
  function tryNativePrompt(){
    if(!deferred||prompted)return false;
    prompted=true;
    var p=deferred.userChoice;deferred=null;
    p.then(function(r){if(r&&r.outcome!=='accepted')toast('没装也没关系，图标随时可以从菜单添加');});
    return true;
  }

  /* 浮动按钮 */
  function showFab(){
    if(document.getElementById('pwaFab'))return;
    var b=document.createElement('div');b.id='pwaFab';
    b.style.cssText='position:fixed;left:14px;bottom:calc(14px + env(safe-area-inset-bottom));z-index:99900;display:flex;align-items:center;gap:8px;background:#2b1220;color:#fff;padding:10px 18px;border-radius:999px;box-shadow:0 6px 20px rgba(43,18,32,.35);font-size:15px;font-weight:700;cursor:pointer;';
    b.innerHTML='📲 <span>把「二外圈」装到'+(env.t==='ios'?'主屏幕':'桌面')+'</span>';
    b.onclick=onFab;document.body.appendChild(b);
    b.style.opacity='0';requestAnimationFrame(function(){b.style.transition='opacity .4s';b.style.opacity='1';});
  }
  function onFab(){
    if(tryNativePrompt())return;        /* ① 能一键装就一键装（Chrome/Edge/三星…） */
    if(env.t==='wechat')showWeChat();
    else if(env.t==='ios')showIos();
    else if(env.t==='desktop')showDesktop();
    else showAndroid();
  }

  /* 图文弹窗 */
  function popup(title,html){
    var ov=document.createElement('div');ov.id='pwaOv';
    ov.style.cssText='position:fixed;inset:0;z-index:99999;background:rgba(20,8,14,.72);display:flex;align-items:flex-end;justify-content:center;';
    var card=document.createElement('div');
    card.style.cssText='background:#fff;border-radius:20px 20px 0 0;width:100%;max-width:520px;padding:22px 18px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box;';
    card.innerHTML='<div style="font-size:17px;font-weight:800;color:#c4002a;margin-bottom:14px;text-align:center">'+title+'</div>'
      +'<div style="display:flex;flex-direction:column;gap:12px">'+html+'</div>'
      +'<div style="text-align:center;margin-top:16px"><button id="pwaOvOk" style="background:#e0498f;color:#fff;border:0;border-radius:999px;padding:12px 48px;font-size:16px;font-weight:700">知道了</button></div>';
    ov.appendChild(card);document.body.appendChild(ov);
    document.getElementById('pwaOvOk').onclick=function(){ov.remove();};
    ov.onclick=function(e){if(e.target===ov)ov.remove();};
  }
  function step(n,txt){return '<div style="display:flex;align-items:flex-start;gap:12px;background:#fff5f9;border:1px solid #ffdbe8;border-radius:14px;padding:12px 14px"><span style="flex:none;width:30px;height:30px;border-radius:50%;background:#e0498f;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px">'+n+'</span><span style="font-size:15px;color:#3a0a1a;line-height:1.6;padding-top:3px">'+txt+'</span></div>';}
  function tip(txt){return '<div style="background:#fff6e6;border:1px solid #f2d9a8;color:#7a5200;border-radius:12px;padding:11px 13px;font-size:13px;line-height:1.7">'+txt+'</div>';}

  /* ---- 安卓 ---- */
  function menuPos(){
    if(env.t==='samsung')return'点 <b>右下角</b> 菜单「≡ / ⋮」';
    return'点 <b>右上角</b> 菜单「≡ / ⋮」';
  }
  function phGoodHint(){
    if(env.t==='baidu')return'（百度里这一项就写着「添加到桌面」）';
    if(env.t==='samsung')return'（三星一般能直接生成独立 App 图标）';
    if(env.t==='qq')return'（QQ 里一般叫「添加到桌面 / 创建桌面图标」）';
    return'';
  }
  function showAndroid(){
    if(env.good){
      popup('把「二外圈」加到桌面（'+env.brand+'）📲',
        step('1',menuPos()+'，往下找')+
        step('2','点 <b>「添加到桌面」或「创建桌面图标」</b>'+phGoodHint())+
        step('3','点「允许 / 好」，桌面出现校徽图标就成功 ✅')+
        tip('点图标打开就是表白墙，跟用 App 一样。图标点开后可能带一条网址栏，正常的，不影响用。'));
    }else{
      popup('把「二外圈」加到桌面（'+env.brand+'）📲',
        tip('💡 <b>最省事</b>：应用商店搜「<b>QQ 浏览器</b>」或「<b>百度</b>」装一个，用它打开本页，再点这个按钮，2 步搞定。')+
        step('A','<b>不换也行</b>：点本页右上角「≡ / ⋮」菜单 →「<b>添加到桌面</b>」→ 允许 ✅')+
        step('B','<b>换浏览器的话</b>：先点本页右上角「⋯ → 复制链接」，再打开 QQ / 百度浏览器粘贴网址，然后按 A 两步就好')+
        tip('两种办法都是把校徽图标放到你的桌面上，点开就是表白墙。'));
    }
  }

  /* ---- 微信 ---- */
  function showWeChat(){
    if(env.ios){
      popup('在微信里装到主屏幕 📲',
        tip('iPhone 的微信装不了图标，借用一下 Safari 就行：')+
        step('1','点右上角「⋯」→「<b>在浏览器中打开</b>」（或直接「复制链接」切到 Safari 粘贴打开）')+
        step('2','Safari 点底部「<b>分享」⬆️</b> →「<b>添加到主屏幕</b>」')+
        step('3','点「<b>添加</b>」，主屏幕出现校徽图标 ✅'));
    }else{
      popup('在微信里加到桌面 📲',
        step('1','点右上角「⋯」→「<b>在浏览器中打开</b>」（没有这一项就点「复制链接」，切到手机浏览器粘贴打开）')+
        step('2','在浏览器里点本页面左下角「📲 安装」按钮，按提示操作')+
        step('3','点「允许 / 好」，桌面出现校徽图标 ✅')+
        tip('小提示：用 QQ 浏览器或百度浏览器打开最顺。'));
    }
  }

  /* ---- 苹果老方案 ---- */
  function showIos(){
    popup('把「二外圈」装到主屏幕 📲',
      step('1','点 Safari 底部「<b>分享</b>」按钮 ⬆️')+
      step('2','下滑点「<b>添加到主屏幕</b>」 ⊞')+
      step('3','点「<b>添加</b>」，主屏幕出现校徽图标 ✅')+
      tip('点开后是全屏的，用起来跟 App 一样。'));
  }

  /* ---- 电脑 ---- */
  function showDesktop(){
    popup('电脑上装「二外圈」💻',
      step('1','先点本页右上角「⋯ → <b>复制网址</b>」（或直接在本浏览器装）')+
      step('2','打开 <b>Chrome 或 Edge</b> 粘贴网址')+
      step('3','看 <b>地址栏最右边的「安装」小图标</b>（人形+箭头），点它 →「安装」 ✅')+
      tip('装好后桌面 / 开始菜单就是独立图标，像真 App 一样打开。'));
  }

  function toast(t){var el=document.createElement('div');el.textContent=t;el.style.cssText='position:fixed;left:50%;bottom:calc(30px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#2b1220;color:#fff;padding:11px 20px;border-radius:999px;z-index:99999;font-size:14px;box-shadow:0 6px 20px rgba(43,18,32,.4)';document.body.appendChild(el);setTimeout(function(){el.remove();},3200);}

  /* 入口：
     pwa 环境（Chrome/Edge）→ 系统可能没弹原生框（首次访问常见），4 秒后无论是否收到都出按钮兜底；
     其他环境 → 2 秒出按钮（好适配直接图文 2 步，自带浏览器推荐换 QQ/百度） */
  if(env.t==='pwa'){setTimeout(function(){if(!deferred)showFab();},4000);}
  else setTimeout(showFab,2000);
})();
