/* wall-common.js — 校花/校草之墙（Supabase 云端共享版）
   页面需在加载本文件前设置 window.WALL_CFG = { key, title, accent, back }
   数据：Supabase（wall_candidates / wall_votes / Storage:wall-photos），全校实时共享
   投票：同一 user_key 对同一候选人仅一票（DB unique 兜底），跨设备一致
*/
(function(){
  const C = window.WALL_CFG || {key:'wall_xiaohua', title:'校花之墙', accent:'pink'};
  const KIND = C.key==='wall_xiaocao' ? 'xiaocao' : 'xiaohua';

  /* ---- Supabase（与主表白墙共用，publishable key 仅用于 anon 读写 + Storage）---- */
  const SUPA_URL="https://dpceuvqtwvhoipxhozxz.supabase.co";
  const SUPA_KEY="sb_publishable_lgsJvhLEHOG9oM1aXH7y1A_pgdmezyA";
  let sb=null;
  function getSB(){
    if(sb) return sb;
    if(!window.supabase){ console.error('supabase-js 未加载'); return null; }
    sb=window.supabase.createClient(SUPA_URL,SUPA_KEY);
    return sb;
  }

  /* ---- 本地身份锚点（投票去重用，清缓存可重置，DB 有 unique 兜底）---- */
  var lastSignTime=0;
  async function signPhotos(rows){
    var out={};
    var rels=(rows||[]).filter(function(p){return p&&p.photo_url&&p.photo_url.trim()!==""&&!/^https?:/.test(p.photo_url);}).map(function(p){return p.photo_url;});
    (rows||[]).forEach(function(p){ if(p&&p.photo_url&&/^https?:/.test(p.photo_url)) out[p.photo_url]=p.photo_url; });
    var list=rels;
    if(!list.length) return out;
    var s2=getSB(); if(!s2) return out;
    try{
      var r=await s2.storage.from("wall-photos").createSignedUrls(list,900);
      (r.data||[]).forEach(function(d){
        var u=d.signedUrl||"";
        if(u&&!/^https?:/.test(u))u=SUPA_URL+"/storage/v1"+u;
        out[d.path]=u;
      });
      lastSignTime=Date.now();
    }catch(e){ console.warn("sign photos",e); }
    return out;
  }
  function userKey(){
    let uk=localStorage.getItem('wallVoteKey');
    if(!uk){ uk='v'+Math.random().toString(36).slice(2)+Date.now().toString(36); localStorage.setItem('wallVoteKey',uk); }
    return uk;
  }
  /* 我投过哪些候选人（本地缓存，刷新更快） */
  function votedIds(){ try{ return JSON.parse(localStorage.getItem('wallVoted_'+KIND)||'[]'); }catch(e){ return []; } }
  function markVoted(id){ const a=votedIds(); if(!a.includes(id)){ a.push(id); localStorage.setItem('wallVoted_'+KIND, JSON.stringify(a)); } }

  let people=[]; let loadErr=false; let loading=true;

  /* ---- 拉候选人（云端，带 try/catch + 超时兜底，失败可重试） ---- */
  var loadLock=0;
  async function loadCands(){
    const s=getSB(); if(!s){ loadErr=true; people=[]; loading=false; return; }
    loading=true; loadErr=false;
    const myLock=++loadLock;
    try{
      const ctrl=typeof AbortController!=="undefined"?new AbortController():null;
      const tmo=ctrl?setTimeout(function(){ctrl.abort();},15000):null;
      const {data,error}=await s.from('wall_candidates')
        .select('id,nickname,class_no,photo_url,like_count,msg,created_ts,voting_on')
        .eq('kind',KIND).eq('status','ok')
        .order('like_count',{ascending:false}).limit(200);
      if(tmo)clearTimeout(tmo);
      if(myLock!==loadLock)return; // 已被更新一次加载取代
      if(error){ loadErr=true; people=[]; } else { people=data||[]; var _pm=await signPhotos(people); people.forEach(function(p){ if(p&&_pm[p.photo_url]) p._src=_pm[p.photo_url]; }); }
    }catch(e){
      if(myLock===loadLock){ console.error('loadCands',e); loadErr=true; people=[]; }
    }finally{
      if(myLock===loadLock)loading=false;
    }
  }

  /* ---- 上传照片 → Storage 桶 wall-photos → 写 wall_candidates ---- */
  async function uploadAndAdd(name,msg,file){
    const s=getSB(); if(!s){ tip('云端未连接'); return; }
    const uk=userKey();
    const path=KIND+'/'+Date.now()+'_'+uk+'_'+Math.random().toString(36).slice(2,6)+'.jpg';
    const {error:upErr}=await s.storage.from('wall-photos').upload(path,file,{contentType:'image/jpeg'});
    if(upErr){ console.error(upErr); tip('照片上传失败：'+upErr.message); return; }
    /* 桶已私有：库里只存稳定相对路径 path，显示时由 signPhotos 客户端签名 */
    /* 切换到 fn_wall_candidate_add RPC：服务端校验 + 限流 + 防破图（PostgREST 需显式传全 6 个参数名） */
    const {data:cand,error:insErr}=await s.rpc('fn_wall_candidate_add',{
      p_kind:KIND, p_nickname:(name||'匿名'), p_class_no:'',
      p_photo_url:path, p_msg:(msg||''), p_user_key:uk
    });
    if(insErr){ console.error(insErr); tip('提交失败：'+insErr.message); return; }
    await loadCands(); render(); tip('已上传 ✔ 全校可见');
  }

  /* ---- 投票（云端，DB unique 兜底一人一票） ---- */
  /* ---- 被拍者/本人申诉（走 Supabase fn_wall_appeal，云端受理+审计，前端零判断） ---- */
  async function appeal(cid){
    const s=getSB(); if(!s){ tip('云端未连接'); return; }
    const uk=userKey();
    var raw=prompt('你是被拍者/本人？请填写申诉理由（如：我是本人，申请删除照片）：');
    if(raw===null)return;
    var reason=(raw||'申请删除').slice(0,200);
    var r=await s.rpc('fn_wall_appeal',{p_target_kind:'candidate',p_target_id:Number(cid),p_reason:reason,p_user_key:uk});
    if(r.error){ tip('申诉未受理：'+((r.error.message||'').replace(/^sensitive:/,'').slice(0,50))); return; }
    tip('申诉已提交 ✅ 管理员会尽快处理（云端受理）');
  }
  async function vote(cid){
    const s=getSB(); if(!s){ tip('云端未连接'); return; }
    const uk=userKey();
    /* 切换到 fn_wall_vote RPC：服务端幂等 + like_count 原子 +1 */
    const {data:voteRes,error:voteErr}=await s.rpc('fn_wall_vote',{p_candidate_id:Number(cid),p_user_key:uk});
    if(voteErr){ tip('投票失败：'+voteErr.message); await loadCands(); render(); return; }
    if(voteRes==='already'){ tip('你已投过这位啦'); }
    else if(voteRes==='not_found'){ tip('候选人不存在'); }
    else { markVoted(cid); tip('投票成功 🌟 全校实时可见'); }
    await loadCands(); render();
  }

  /* ---- 图片压缩（保留原逻辑） ---- */
  function fileToDataURL(file,maxW){
    return new Promise(function(res,rej){
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
  /* 压缩后返回 Blob（供 Storage 上传） */
  async function fileToBlob(file,maxW){
    const dataUrl=await fileToDataURL(file,maxW);
    const bin=atob(dataUrl.split(',')[1]);
    const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    return new Blob([arr],{type:'image/jpeg'});
  }

  /* ---- XSS 转义 ---- */
  function esc(s){ return (s||'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]}); }

  /* ---- 导航（与 4 页统一 .nav 风格一致） ---- */
  function nav(){
    const items=[
      {t:'🏠 总入口', f:'index.html', on:false},
      {t:'🌸 校花', f:'xiaohua-wall.html', on:KIND==='xiaohua'},
      {t:'🌿 校草', f:'xiaocao-wall.html', on:KIND==='xiaocao'},
      {t:'❤️ 表白', f:'love-wall.html', on:false}
    ];
    return '<span class="brand">🏫 校园墙<small>· 重庆第二外国语学校</small></span>'+
      items.map(function(a){ return '<a class="nl'+(a.on?' cur':'')+'" href="'+a.f+'">'+a.t+'</a>'; }).join('');
  }

  function render(){
    const app=document.getElementById('app'); if(!app) return;
    const myVotes=votedIds();
    let h='<div class="wrap">';
    h+='<nav class="wall-nav"><div class="wall-nav-in">'+nav()+'</div></nav>';
    // 统计
    const total=people.reduce(function(s,p){return s+(p.like_count||0);},0);
    h+='<div class="stats"><span>📸 候选人 '+people.length+'</span><span>🗳️ 累计 '+total+' 票</span><span>☁️ 全校实时共享</span></div>';
    // 上传（匿名也可传，带昵称/一句话）
    h+='<div class="panel">'
      +'<h3>📷 上传'+esc(C.title)+'照片（全校可见）</h3>'
      +'<div class="row"><input id="upName" maxlength="12" placeholder="展示昵称（可匿名）"><input id="upMsg" maxlength="40" placeholder="一句话介绍（可选）"></div>'
      +'<div class="row"><input id="upFile" type="file" accept="image/*"><button class="btn" id="upGo">压缩并上传</button></div>'
      +'<p class="note">照片上传到云端，全校实时可见。请仅上传本人或获得授权的素材，勿传他人隐私。</p>'
      +'</div>';
    // 投票墙
    h+='<h3 class="sec-title">🗳️ 投票（每人一票 · 全校共享排名）</h3>';
      h+='<div class="note" style="font-size:12px;color:#8a5a68;line-height:1.6;margin-bottom:8px">📌 投票与肖像须知：每人一票，请理性参与、勿对特定同学施加舆论压力；照片请仅上传本人或已获授权的素材，被拍者可联系管理申请删除。</div>';
    if(loading){
      h+='<div class="empty"><div class="loading-spin"></div>加载中…</div>';
    } else if(loadErr){
      h+='<div class="empty err">加载失败 <a id="retryLoad" href="javascript:;">点击重试</a></div>';
    } else if(people.length===0){
      h+='<div class="empty">还没有候选人，上传第一张吧 ☝️</div>';
    } else {
      h+='<div class="grid">';
      people.forEach(function(p,i){
        const c=p.like_count||0;
        const rank=i+1;
        const medal=rank===1?'🥇':rank===2?'🥈':rank===3?'🥉':'#'+rank;
        const done=myVotes.includes(p.id);
        h+='<div class="card">'
          +'<div class="ph"><img src="'+esc(p._src||"")+'" loading="lazy" alt="" data-id="'+p.id+'" onerror="this.classList.add(\'broken\');this.parentNode.classList.add(\'empty-photo\');this.style.display=\'none\';"><span class="ph-ph"></span><span class="medal">'+medal+'</span></div>'
          +'<div class="body">'
          +'<div class="nm">'+esc(p.nickname||'匿名')+'</div>'
          +(p.msg?'<div class="ms">'+esc(p.msg)+'</div>':'')
          +'<div class="vf"><button class="vote '+(done?'done':'')+'" data-vote="'+p.id+'" '+((done||p.voting_on===false)?'disabled':'')+' style="margin-right:6px">'+(p.voting_on===false?'投票已关闭':(done?'已投':'投票'))+'</button>'
          +'<button class="vote" data-appeal="'+p.id+'" style="margin-right:6px;opacity:.85">申诉</button>'
          +'<span class="ct">'+c+' 票</span></div>'
          +'</div>'
          
          +'</div>';
      });
      h+='</div>';
    }
    h+='<div class="note center" id="ipNote"></div></div>';
    app.innerHTML=h;
    bind();
  }

  function bind(){
    const up=document.getElementById('upGo');
    if(up){ up.onclick=function(){
      const f=document.getElementById('upFile').files[0];
      const nm=document.getElementById('upName').value.trim();
      const msg=document.getElementById('upMsg').value.trim();
      if(!f){ tip('请选择一张照片'); return; }
      /* 上传类型/大小校验：防异型/超大文件拖垮 */
      if(!/^image\/(jpe?g|png|webp)$/.test(f.type)){ tip('只支持 JPG/PNG/WEBP 图片'); return; }
      if(f.size>15*1024*1024){ tip('图片不能超过 15MB'); return; }
      up.disabled=true; up.textContent='上传中…';
      fileToBlob(f,720).then(function(blob){
        uploadAndAdd(nm,msg,blob).catch(function(e){ tip('上传出错：'+(e&&e.message||e)); }).finally(function(){ up.disabled=false; up.textContent='压缩并上传'; var inp=document.getElementById('upFile'); if(inp)inp.value=''; });
      }).catch(function(e){ up.disabled=false; up.textContent='压缩并上传'; tip('压缩失败：'+(e&&e.message||e)); });
    }; }
    document.querySelectorAll('[data-vote]').forEach(function(b){
      b.onclick=function(){ vote(b.getAttribute('data-vote')); };
    });
    document.querySelectorAll('[data-appeal]').forEach(function(b){
      b.onclick=function(){ appeal(b.getAttribute('data-appeal')); };
    });
    const rt=document.getElementById('retryLoad');
    if(rt){ rt.onclick=function(){ if(typeof window.supabase==='undefined'){ location.reload(); return; } loading=false; loadCands().then(function(){ render(); }).catch(function(){ render(); }); }; }
    // 深色模式跟随
    if(localStorage.getItem('wallDark')==='1') document.body.classList.add('dark');
  }

  var _tipT;
  function tip(msg){
    var t=document.getElementById('lgTip')||document.getElementById('ipNote');
    if(!t){ alert(msg); return; }
    t.textContent=msg; t.classList.add('show'); clearTimeout(_tipT); _tipT=setTimeout(function(){t.classList.remove('show');},2600);
  }

  window.WALL={ render:render, refresh:function(){ loadCands().then(function(){ render(); }).catch(function(){ render(); }); } };
  document.addEventListener('visibilitychange',function(){ if(!document.hidden&&lastSignTime&&Date.now()-lastSignTime>600000){ loadCands().then(function(){ render(); }).catch(function(){}); } });
  /* storage 事件：跨标签页刷新，带锁 + 不覆盖进行中加载 */
  window.addEventListener('storage',function(){ loadCands().then(function(){ if(loadLock===loadLock&&!loading){ render(); } }).catch(function(){}); });
  /* 顶层：未捕获 Promise 兜底，失败仍 render 出重试入口 */
  loadCands().then(function(){ render(); }).catch(function(e){ console.error('init',e); render(); });
})();
