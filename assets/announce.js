/* assets/announce.js — 全站公告横幅
   行为：每个页面打开时，只要处于「未关闭 / 关闭已超过 15 分钟」状态就显示；
   用户点「知道了」关闭后，写 15 分钟静默窗口，期间所有页面都不再弹；
   15 分钟后再次打开页面又会显示。内容来自云端 wall_announcements（enabled=true，最新一条），
   管理员在 admin.html 的 Edge 里增改，前端不做任何内容判断。 */
(function(){
  "use strict";
  if(window.__announceLoaded) return;
  window.__announceLoaded = true;

  var SUPA   = "https://dpceuvqtwvhoipxhozxz.supabase.co";
  var ANON   = "sb_publishable_lgsJvhLEHOG9oM1aXH7y1A_pgdmezyA";
  var SKEY   = "wallAnnounceDismissed";      // localStorage: {key, ts}
  var MUTE   = 15*60*1000;                    // 关闭后 15 分钟内不再出现

  function css(){
    var s = document.createElement("style");
    s.textContent = [
      ".wa-banner{position:sticky;top:0;z-index:9999;box-sizing:border-box;",
      "  display:flex;align-items:center;gap:10px;",
      "  padding:10px 14px;max-width:100%;",
      "  background:linear-gradient(135deg,#fff5f7,#ffe9ef);",
      "  border-bottom:1px solid #ffd7e0;",
      "  box-shadow:0 4px 14px rgba(196,0,42,.10);",
      "  font-size:13px;line-height:1.55;color:#3a0a1a;",
      "  font-family:'Microsoft YaHei','PingFang SC',sans-serif;}",
      "body.dark .wa-banner{background:linear-gradient(135deg,#1a0810,#2a0f18);",
      "  border-bottom:1px solid #4a1626;box-shadow:0 4px 14px rgba(0,0,0,.5);color:#f5dfe6;}",
      ".wa-ico{flex:none;font-size:18px}",
      ".wa-txt{flex:1;min-width:0}",
      ".wa-title{font-weight:800;margin-bottom:2px;color:#c4002a}",
      "body.dark .wa-title{color:#ff8fa3}",
      ".wa-body{color:#8a5a68;word-break:break-word}",
      "body.dark .wa-body{color:#c79ba8}",
      ".wa-close{flex:none;cursor:pointer;font-size:16px;line-height:1;",
      "  width:28px;height:28px;border-radius:50%;",
      "  border:1px solid #ffd7e0;background:#fff;color:#c4002a;",
      "  display:flex;align-items:center;justify-content:center;}",
      ".wa-close:hover{background:#c4002a;color:#fff}",
      "body.dark .wa-close{background:#2a1018;border-color:#4a1626;color:#ff8fa3}"
    ].join("");
    document.head.appendChild(s);
  }

  function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}

  function show(a, key){
    var host = document.createElement("div");
    host.className = "wa-banner";
    host.setAttribute("role","banner");
    host.innerHTML =
      '<span class="wa-ico">\u{1F4E2}</span>'+
      '<div class="wa-txt">'+
        '<div class="wa-title">'+(esc(a.title)||"全站公告")+'</div>'+
        '<div class="wa-body">'+esc(a.content)+'</div>'+
      '</div>'+
      '<button class="wa-close" aria-label="知道了">'+String.fromCharCode(10005)+'</button>';
    host.querySelector(".wa-close").addEventListener("click", function(){
      try{ localStorage.setItem(SKEY, JSON.stringify({key:key, ts:Date.now()})); }catch(e){}
      host.style.transition="opacity .25s"; host.style.opacity="0";
      setTimeout(function(){ host.remove(); }, 260);
    });
    // 插到 body 顶部，吸顶显示
    if(document.body.firstChild){ document.body.insertBefore(host, document.body.firstChild); }
    else { document.body.appendChild(host); }
  }

  function boot(){
    fetch(SUPA+"/rest/v1/wall_announcements?enabled=eq.true&select=id,title,content,updated_at&order=updated_at.desc&limit=1",
          {headers:{apikey:ANON, Authorization:"Bearer "+ANON}})
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){
        if(!Array.isArray(rows) || !rows.length) return;
        var a = rows[0];
        var key = String(a.id)+"_"+String(a.updated_at||"");
        var now = Date.now();
        var d = null;
        try{ d = JSON.parse(localStorage.getItem(SKEY)||"null"); }catch(e){ d=null; }
        if(d && d.key===key && (now - (d.ts|0)) < MUTE) return; // 静默窗口内，不弹
        css();
        show(a, key);
      })
      .catch(function(){}); // 网络失败：静默降级，不阻塞页面
  }

  if(document.readyState==="loading"){ document.addEventListener("DOMContentLoaded", boot); }
  else { boot(); }
})();
