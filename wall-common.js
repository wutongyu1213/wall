/* wall-common.js — 校花/校草之墙共享逻辑
   页面需在加载本文件前设置 window.WALL_CFG = { key, title, accent, back }
   数据：localStorage[CFG.key] 自包含（照片压缩为 dataURL + 账号 + 投票 + IP 锁）
   手机号登录：演示级（屏显 6 位验证码）。接入真实短信需付费服务 + 后端，无法全自动开通。
   投票规则：需登录；同一 IP 在本墙只能投一票（跨人全局唯一）。
*/
(function(){
  const C = window.WALL_CFG || {key:'wall_v1', title:'之墙', accent:'pink'};
  const DATA_KEY = C.key;
  const DEFAULTS = { users:[], account:null, people:[], votes:{}, seq:1 };
  function load(){ try{ return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(DATA_KEY)||'{}')); }catch(e){ return Object.assign({}, DEFAULTS); } }
  function save(d){ localStorage.setItem(DATA_KEY, JSON.stringify(d)); }
  let D = load();

  /* ---- IP：免费接口 + 设备指纹兜底（保证“每 IP 一票”离线也可执行） ---- */
  async function getIP(){
    const eps = ['https://api.ipify.org?format=json','https://ip.sb/jsonip','https://api.ipify.org'];
    for(const u of eps){
      try{
        const r = await fetch(u, {mode:'cors'});
        const j = await r.json();
        const ip = j.ip || j;
        if(typeof ip==='string' && ip) return ip;
      }catch(e){}
    }
    let h=0; const s=navigator.userAgent+'|'+screen.width+'x'+screen.height+'|'+Intl.DateTimeFormat().resolvedOptions().timeZone+'|'+Math.random();
    for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0;
    return 'dev-'+h.toString(16);
  }
  function ipVoted(ip){ const vs=D.votes||{}; return Object.keys(vs).some(k=>(vs[k]||[]).includes(ip)); }

  /* ---- 图片压缩 ---- */
  function fileToDataURL(file, maxW){
    return new Promise(function(res, rej){
      const rd=new FileReader();
      rd.onload=function(e){
        const img=new Image();
        img.onload=function(){
          const sc=Math.min(1,(maxW||720)/img.width);
          const cv=document.createElement('canvas');
          cv.width=Math.round(img.width*sc); cv.height=Math.round(img.height*sc);
          cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
          res(cv.toDataURL('image/jpeg',0.72));
        };
        img.onerror=rej; img.src=e.target.result;
      };
      rd.onerror=rej; rd.readAsDataURL(file);
    });
  }

  /* ---- 手机号登录（演示级） ---- */
  function validPhone(p){ return /^1[3-9]\d{9}$/.test(p||''); }
  function requestCode(p){ const c=String(Math.floor(100000+Math.random()*900000)); sessionStorage.setItem(DATA_KEY+'_code_'+p, c); return c; }
  function verifyCode(p,c){ return sessionStorage.getItem(DATA_KEY+'_code_'+p)===String(c); }
  function doLogin(p, name){
    let u=(D.users||[]).find(x=>x.phone===p);
    if(!u){ u={phone:p,name:name||('用户'+p.slice(-4)),createdAt:Date.now()}; D.users=D.users||[]; D.users.push(u); }
    D.account=p; save(D);
  }
  function logout(){ D.account=null; save(D); }
  function me(){ return (D.users||[]).find(x=>x.phone===D.account); }

  /* ---- 投票 ---- */
  function castVote(pid, ip){
    if(!D.account) return {ok:false, reason:'login'};
    if(ipVoted(ip)) return {ok:false, reason:'ip'};
    D.votes=D.votes||{}; D.votes[pid]=D.votes[pid]||[]; D.votes[pid].push(ip);
    save(D); return {ok:true};
  }
  function count(pid){ return (D.votes&&D.votes[pid]&&D.votes[pid].length)||0; }

  /* ---- 上传 ---- */
  function addPerson(o){ const p=Object.assign({id:'p'+(D.seq++)}, o); D.people=D.people||[]; D.people.push(p); save(D); return p; }

  /* ---- 渲染 ---- */
  function esc(s){ return (s||'').replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]}); }
  function nav(){
    const items=[
      {t:'💌 我的表白墙', f:'love-wall.html'},
      {t:'🌸 校花之墙', f:'xiaohua-wall.html', on:C.accent==='pink'},
      {t:'🌿 校草之墙', f:'xiaocao-wall.html', on:C.accent==='blue'}
    ];
    return items.map(function(a){
      return '<a class="nav-a '+(a.on?'on':'')+'" href="'+a.f+'">'+a.t+'</a>';
    }).join('');
  }

  function render(){
    const app=document.getElementById('app'); if(!app) return;
    const login=D.account? me():null;
    let h='<div class="wrap">';
    h+='<div class="topnav"><span class="brand">'+esc(C.title)+'</span><div class="links">'+nav()+'</div></div>';

    // 统计
    const total=(D.people||[]).reduce(function(s,p){return s+count(p.id);},0);
    h+='<div class="stats"><span>📸 候选人 '+(D.people||[]).length+'</span><span>🗳️ 已投票 '+total+'</span><span>👥 注册用户 '+(D.users||[]).length+'</span></div>';

    // 登录 / 用户区
    if(!login){
      h+='<div class="panel"><h3>🔐 手机号登录 / 注册</h3>'
       +'<p class="note">登录或注册后即可上传照片并投票。<b>演示模式</b>：验证码直接显示在页面（接真实短信需付费服务+后端）。</p>'
       +'<div class="row"><input id="lgPhone" inputmode="numeric" maxlength="11" placeholder="手机号（11 位）"></div>'
       +'<div class="row"><input id="lgName" maxlength="12" placeholder="昵称（可选）"><button class="btn ghost" id="lgSend">获取验证码</button></div>'
       +'<div class="row"><input id="lgCode" maxlength="6" placeholder="输入 6 位验证码"><button class="btn" id="lgGo">登录 / 注册</button></div>'
       +'<div class="code-tip" id="lgTip"></div>'
       +'</div>';
    } else {
      h+='<div class="panel small"><h3>👤 当前账号：'+esc(login.name)+'（'+esc(login.phone)+'）</h3><button class="btn ghost" id="lgOut">退出</button></div>';
    }

    // 上传（需登录）
    if(login){
      h+='<div class="panel"><h3>📷 上传我的照片（'+esc(C.title)+'）</h3>'
       +'<div class="row"><input id="upName" maxlength="12" placeholder="展示昵称"><input id="upMsg" maxlength="40" placeholder="一句话介绍（可选）"></div>'
       +'<div class="row"><input id="upFile" type="file" accept="image/*"><button class="btn" id="upGo">压缩并上传</button></div>'
       +'<p class="note">照片在浏览器端压缩后仅保存在本机；跨设备共享需对象存储（未开通）。</p>'
       +'</div>';
    }

    // 投票墙
    const ppl=D.people||[];
    h+='<h3 class="sec-title">🗳️ 投票（每个 IP 只能投一票，需登录）</h3>';
    if(ppl.length===0){
      h+='<div class="empty">还没有人上传照片。登录并上传第一张吧。</div>';
    } else {
      const ranked=ppl.slice().sort(function(a,b){return count(b.id)-count(a.id);});
      h+='<div class="grid">';
      ranked.forEach(function(p,i){
        const c=count(p.id);
        const rank=ranked.findIndex(function(x){return x.id===p.id;})+1;
        const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'#'+rank;
        h+='<div class="card">'
          +'<div class="ph"><img src="'+p.img+'" alt=""><span class="medal">'+medal+'</span></div>'
          +'<div class="nm">'+esc(p.nickname||'匿名')+'</div>'
          +(p.msg?'<div class="ms">'+esc(p.msg)+'</div>':'')
          +'<div class="vf"><button class="vote '+(login?'':'dis')+'" data-vote="'+p.id+'">投票</button>'
          +'<span class="ct">'+c+' 票</span></div>'
          +'</div>';
      });
      h+='</div>';
    }
    h+='<div class="note center" id="ipNote"></div></div>';
    app.innerHTML=h;
    bind();
  }

  function bind(){
    // 登录
    var send=document.getElementById('lgSend');
    if(send){ send.onclick=function(){
      var p=document.getElementById('lgPhone').value.trim();
      if(!validPhone(p)){ tip('请输入有效的 11 位手机号'); return; }
      var code=requestCode(p);
      document.getElementById('lgCode').value='';
      document.getElementById('lgName').value=document.getElementById('lgName').value||'';
      var t=document.getElementById('lgTip'); t.textContent='✅ 演示验证码：'+code; t.classList.add('show');
    }; }
    var go=document.getElementById('lgGo');
    if(go){ go.onclick=function(){
      var p=document.getElementById('lgPhone').value.trim();
      var cd=document.getElementById('lgCode').value.trim();
      var nm=document.getElementById('lgName').value.trim();
      if(!verifyCode(p,cd)){ tip('验证码错误'); return; }
      doLogin(p,nm); D=load(); render();
      var t=document.getElementById('ipNote'); if(t) t.textContent='🔑 已登录：'+p;
    }; }
    var out=document.getElementById('lgOut');
    if(out){ out.onclick=function(){ logout(); D=load(); render(); }; }

    // 上传
    var up=document.getElementById('upGo');
    if(up){ up.onclick=function(){
      var f=document.getElementById('upFile').files[0];
      var nm=document.getElementById('upName').value.trim();
      var msg=document.getElementById('upMsg').value.trim();
      if(!f){ tip('请选择一张照片'); return; }
      fileToDataURL(f,720).then(function(url){
        addPerson({ nickname: nm||me().name, msg:msg, img:url, createdAt:Date.now() });
        D=load(); render(); tip('已上传 ✔');
        var inp=document.getElementById('upFile'); if(inp) inp.value='';
      });
    }; }

    // 投票
    document.querySelectorAll('[data-vote]').forEach(function(b){
      b.onclick=function(){
        if(!D.account){ tip('请先登录'); return; }
        getIP().then(function(ip){
          var r=castVote(b.getAttribute('data-vote'), ip);
          if(r.ok){ D=load(); render(); var n=document.getElementById('ipNote'); if(n) n.textContent='✅ 你（IP '+ip+'）已投票，本墙不可再投'; tip('投票成功'); }
          else if(r.reason==='ip'){ D=load(); render(); var n2=document.getElementById('ipNote'); if(n2) n2.textContent='⚠️ 该 IP 已投过一票，不可再投'; }
          else { tip('请先登录'); }
        });
      };
    });

    // IP 状态展示
    getIP().then(function(ip){
      var n=document.getElementById('ipNote'); if(!n) return;
      if(ipVoted(ip)) n.textContent='⚠️ 此 IP 已在本墙投过票，无法再次投票';
      else if(!D.account) n.textContent='检测到 IP：'+ip+'（登录后即可投票，每 IP 一票）';
      else n.textContent='你的 IP：'+ip+'，可投一票';
    });
  }

  var _tipT;
  function tip(msg){
    var t=document.getElementById('lgTip')||document.getElementById('ipNote');
    if(t){ t.textContent=msg; t.classList.add('show'); clearTimeout(_tipT); _tipT=setTimeout(function(){t.classList.remove('show');},2600); }
  }

  window.WALL = { render:render, refresh:function(){D=load();render();} };
  // 跨页事件刷新
  window.addEventListener('storage', function(){ D=load(); render(); });
  render();
})();
