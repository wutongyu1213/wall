/* wall-bgm.js — 校园墙通用背景音乐模块
   · 音乐托管 Supabase 云端（公开桶 wall-audio）为唯一音源（本地 Pages 已移除 mp3）
   · 右下角悬浮 ♪ 开关；点击开始/停止；状态记 localStorage，回页自动续播
   · 自动播放受浏览器策略限制：需用户点过一次，否则静默待命，点一下即响
   · 页面 <body> 末尾引入： <script src="assets/bgm.js?v=1"></script>
*/
(function(){
  var SUPA="https://dpceuvqtwvhoipxhozxz.supabase.co";
  // 云端唯一音源（Supabase 公开桶 wall-audio）
  var BGM_CLOUD=SUPA+"/storage/v1/object/public/wall-audio/bgm.mp3";
  var BGM_URLS=[BGM_CLOUD];
  var KEY="wallBgmOn";

  if(window.__wallBgmLoaded)return; window.__wallBgmLoaded=true;

  function build(){
    var a=document.createElement("audio");
    a.id="wallBgmAudio"; a.loop=true; a.preload="none"; a.volume=0.5;
    a.style.cssText="display:none";
    document.body.appendChild(a);

    var btn=document.createElement("button");
    btn.id="wallBgmBtn";
    btn.setAttribute("aria-label","背景音乐开关");
    btn.style.cssText=[
      "position:fixed;bottom:18px;right:16px;z-index:950",
      "width:48px;height:48px;border-radius:50%;border:1.5px solid rgba(196,0,42,.18)",
      "background:rgba(255,255,255,.92);backdrop-filter:blur(6px)",
      "box-shadow:0 8px 20px rgba(0,0,0,.18);cursor:pointer",
      "font-size:22px;line-height:1;display:flex;align-items:center;justify-content:center",
      "color:#c4002a;transition:transform .18s,box-shadow .18s,opacity .18s;opacity:.9"
    ].join(";");
    btn.textContent="♪";
    btn.title="背景音乐";
    document.body.appendChild(btn);

    var idx=0;
    function setSrc(){ a.src=BGM_URLS[idx]; }
    setSrc();

    function play(){
      a.play().then(function(){
        btn.classList.add("on"); btn.textContent="♪";
        localStorage.setItem(KEY,"on");
      }).catch(function(){
        // 自动播放被拦 → 换个源或等手势
        idx++; if(idx<BGM_URLS.length)setSrc();
        // 绑定一次手势续播
        function go(){ a.play().then(function(){btn.textContent="♪";}).catch(function(){});
          document.removeEventListener("pointerdown",go); document.removeEventListener("touchend",go); }
        document.addEventListener("pointerdown",go); document.addEventListener("touchend",go);
      });
    }
    function pause(){ a.pause(); a.currentTime=0; localStorage.setItem(KEY,"off"); }
    function toggle(){ a.paused ? play() : pause(); }

    btn.addEventListener("click",toggle);

    // 页面显示时若之前开着 → 尝试续播（浏览器允许则响，不允许则等手势）
    if(localStorage.getItem(KEY)==="on"){
      play();
      document.addEventListener("visibilitychange",function(){
        if(!document.hidden && localStorage.getItem(KEY)==="on" && a.paused){ a.play().catch(function(){}); }
      });
    }
    // 离开页面时自动暂停（跨页不串音）
    window.addEventListener("pagehide",function(){ a.pause(); });
    a.addEventListener("error",function(){ idx++; if(idx<BGM_URLS.length){ setSrc(); if(!a.paused)play(); } });
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",build);
  else build();
})();
