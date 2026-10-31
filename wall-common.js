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
      if(r.error){
        /* 批签失败（如批内含坏路径）→ 逐张降级签名，避免单条坏路径拖垮整批真实照片 */
        for(var i=0;i<list.length;i++){
          var one=await s2.storage.from("wall-photos").createSignedUrl(list[i],900);
          if(one.error)continue;
          var u0=(one.data&&one.data.signedUrl)||"";
          if(u0&&!/^https?:/.test(u0))u0=SUPA_URL+"/storage/v1"+u0;
          if(u0)out[list[i]]=u0;
        }
      }else{
        (r.data||[]).forEach(function(d){
          var u=d.signedUrl||"";
          if(u&&!/^https?:/.test(u))u=SUPA_URL+"/storage/v1"+u;
          out[d.path]=u;
        });
      }
      lastSignTime=Date.now();
    }catch(e){ console.warn("sign photos",e); }
    return out;
  }
  /* 批量签名任意 url 数组（主照 + 挂照共用） */
  async function signUrls(list){
    var out={};
    var rels=(list||[]).filter(function(u){return u&&u.trim()!==''&&!/^https?:/.test(u);});
    (list||[]).forEach(function(u){ if(u&&/^https?:/.test(u)) out[u]=u; });
    if(!rels.length) return out;
    var s2=getSB(); if(!s2) return out;
    try{
      var r=await s2.storage.from("wall-photos").createSignedUrls(rels,900);
      if(r.error){
        for(var i=0;i<rels.length;i++){
          var one=await s2.storage.from("wall-photos").createSignedUrl(rels[i],900);
          if(one.error)continue;
          var u0=(one.data&&one.data.signedUrl)||'';
          if(u0&&!/^https?:/.test(u0))u0=SUPA_URL+"/storage/v1"+u0;
          if(u0)out[rels[i]]=u0;
        }
      }else{
        (r.data||[]).forEach(function(d){ var u=d.signedUrl||""; if(u&&!/^https?:/.test(u))u=SUPA_URL+"/storage/v1"+u; out[d.path]=u; });
      }
      lastSignTime=Date.now();
    }catch(e){ console.warn("signUrls",e); }
    return out;
  }

  /* S2：身份 = 设备指纹（清缓存不重置）；IP 维度由 wall-fp Edge 提供 */
  function wallIp(){ try{ return (window.__wallDevice&&window.__wallDevice.ip())||undefined; }catch(e){ return undefined; } }
  function userKey(){
    if(window.__wallDevice){ try{ var d=window.__wallDevice.id(); if(d) return d; }catch(e){} }
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
      if(error){ loadErr=true; people=[]; } else {
        people=data||[];
        var _pm=await signPhotos(people); people.forEach(function(p){ if(p&&_pm[p.photo_url]) p._src=_pm[p.photo_url]; });
        /* P3：同名多照 —— 拉 candidate_photos 挂照（status=ok），签名后挂到各自候选 */
        var ids=people.map(function(x){return x.id;});
        var gmap={};
        if(ids.length){
          var ph=await s.from('candidate_photos').select('candidate_id,photo_url,seq').eq('status','ok').in('candidate_id',ids).order('seq');
          (ph.data||[]).forEach(function(r){ (gmap[r.candidate_id]=gmap[r.candidate_id]||[]).push(r.photo_url); });
          var extraUrls=[];
          Object.keys(gmap).forEach(function(cid){ (gmap[cid]||[]).forEach(function(u){ if(u&&u.trim()!==''&&extraUrls.indexOf(u)<0) extraUrls.push(u); }); });
          var _pm2=await signUrls(extraUrls);
          people.forEach(function(p){
            p._photos=((gmap[p.id]||[]).map(function(u){return _pm2[u];}).filter(function(u){return u;})).filter(function(u,ix,all){return all.indexOf(u)===ix;});
          });
        }
      }
    }catch(e){
      if(myLock===loadLock){ console.error('loadCands',e); loadErr=true; people=[]; }
    }finally{
      if(myLock===loadLock)loading=false;
    }
  }

  /* ---- 上传照片 → Storage 桶 wall-photos → 写 wall_candidates ---- */
  async function uploadAndAdd(name,msg,file,autoReview,aiReview){
    const s=getSB(); if(!s){ tip('云端未连接'); return false; }
    const uk=userKey();
    const path=KIND+'/'+Date.now()+'_'+uk+'_'+Math.random().toString(36).slice(2,6)+'.jpg';
    const {error:upErr}=await s.storage.from('wall-photos').upload(path,file,{contentType:'image/jpeg'});
    if(upErr){ console.error(upErr); tip('照片上传失败：'+upErr.message); return; }
    /* 桶已私有：库里只存稳定相对路径 path，显示时由 signPhotos 客户端签名 */
    /* 切换到 fn_wall_candidate_add RPC：服务端校验 + 限流 + 防破图（PostgREST 需显式传全 6 个参数名） */
    const {data:cand,error:insErr}=await s.rpc('fn_wall_candidate_add',{
      p_kind:KIND, p_nickname:(name||'匿名'), p_class_no:'',
      p_photo_url:path, p_msg:(msg||''), p_user_key:uk, p_ip:wallIp(), p_auto_review:(autoReview||''), p_ai_review:(aiReview&&aiReview.ok===true)?aiReview:null
    });
    if(insErr){ console.error(insErr); tip('提交失败：'+insErr.message); return false; }
    await loadCands(); render();
    var ai=aiReview||null;
    if(autoReview==='pass' && (!ai||ai.ok!==true||ai.verdict==='safe')) tip('已上传 ✔ 自动通过（AI 安全），全校可见');
    else if(ai&&ai.ok===true&&ai.verdict!=='safe') tip('已上传 · AI 标记为'+(ai.verdict==='risky'?'较高风险':'可疑')+'，进入人工预审队列');
    else tip('已上传，进入预审队列，管理员复核后全校可见');
    return true;
  }

  /* ---- 投票（云端，DB unique 兜底一人一票） ---- */
  /* ---- 被拍者/本人申诉（走 Supabase fn_wall_appeal，云端受理+审计，前端零判断） ---- */
  async function appeal(cid){
    const s=getSB(); if(!s){ tip('云端未连接'); return; }
    const uk=userKey();
    var raw=prompt('你是被拍者/本人？请填写申诉理由（如：我是本人，申请删除照片）：');
    if(raw===null)return;
    var reason=(raw||'申请删除').slice(0,200);
    var r=await s.rpc('fn_wall_appeal',{p_target_kind:'candidate',p_target_id:Number(cid),p_reason:reason,p_user_key:uk,p_ip:wallIp()});
    if(r.error){ tip('申诉未受理：'+((r.error.message||'').replace(/^sensitive:/,'').slice(0,50))); return; }
    tip('申诉已提交 ✅ 管理员会尽快处理（云端受理）');
  }
  async function vote(cid){
    const s=getSB(); if(!s){ tip('云端未连接'); return; }
    const uk=userKey();
    /* 切换到 fn_wall_vote RPC：服务端幂等 + like_count 原子 +1 */
    const {data:voteRes,error:voteErr}=await s.rpc('fn_wall_vote',{p_candidate_id:Number(cid),p_user_key:uk,p_ip:wallIp()});
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

  /* P1：本地预审（格式/大小/尺寸/比例）→ 决定 auto_review：pass=直接可见 / review=进人工队列 */
  function preReview(file){
    var out={ok:true,reason:'',pass:false};
    if(!/^image\/(jpe?g|png|webp)$/i.test(file.type||'')){ out.ok=false; out.reason='格式需为 JPG / PNG / WEBP'; return Promise.resolve(out); }
    if(file.size>15*1024*1024){ out.ok=false; out.reason='图片不能超过 15MB'; return Promise.resolve(out); }
    return new Promise(function(res){
      var url; try{url=URL.createObjectURL(file);}catch(e){out.ok=false;out.reason='无法读取文件';res(out);return;}
      var im=new Image();
      im.onload=function(){
        try{URL.revokeObjectURL(url);}catch(e){}
        var longest=Math.max(im.width,im.height);
        var ratio=Math.min(im.width/Math.max(im.height,1),im.height/Math.max(im.width,1));
        if(longest<300){ out.ok=false; out.reason='图片太小（边长需≥300px）'; res(out); return; }
        if(ratio<0.4||ratio>2.5){ out.pass=false; out.reason='图片比例异常，需人工复核'; res(out); return; }
        out.pass=true; res(out);
      };
      im.onerror=function(){ out.ok=false; out.reason='图片无法读取（可能已损坏）'; try{URL.revokeObjectURL(url);}catch(e){} res(out); };
      im.src=url;
    });
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
    // 复用页面自带 .nav/.nav-in 样式；页面若已静态渲染导航则不重复注入
    const existed=document.querySelector('nav.nav')?true:false;
    return {items:items, existed:existed};
  }

  /* 无照片 / 照片加载失败 → 昵称首字彩色头像占位（不再是永远"照片加载中"） */
  function avatarEl(cid,nm){
    var ch=String(nm||'匿').trim().charAt(0).toUpperCase()||'?';
    var phs=['#e0498f','#c4002a','#8a4dbf','#3b6fd6','#f4743b','#2a9d6f'];
    var bg=phs[(Number(cid)||0)%phs.length];
    var d=document.createElement('div');
    d.className='ph-ava';
    d.style.background='linear-gradient(150deg,'+bg+' 0%,#fff5f7 160%)';
    d.innerHTML='<span class="ph-ava-ch">'+esc(ch)+'</span><span class="ph-ava-sub">📷 未展示照片</span>';
    return d;
  }
  /* 全局钩子：img onerror 调这里，换成头像占位 */
  window.__phFail=function(img){
    var ph=img?img.parentNode:null;
    if(!ph||ph.getAttribute('data-ava')==='1')return;
    ph.setAttribute('data-ava','1');
    if(img.parentNode)img.remove();
    ph.insertBefore(avatarEl(ph.getAttribute('data-cid'),ph.getAttribute('data-nm')),ph.firstChild);
  };
  function render(){
    const app=document.getElementById('app'); if(!app) return;
    const myVotes=votedIds();
    let h='<div class="wrap">';
    const navR=nav();
    if(!navR.existed){
      h+='<nav class="nav"><div class="nav-in"><span class="brand">🏫 校园墙<small>· 重庆第二外国语学校</small></span>'+
        navR.items.map(function(a){ return '<a class="nl'+(a.on?' cur':'')+'" href="'+a.f+'">'+a.t+'</a>'; }).join('')+
        '</div></nav>';
    }
    // 主视觉 hero（CSS 由各页提供）
    h+='<header class="hero"><h1>'+esc(C.title||'校园墙')+'</h1><p class="hero-sub">全校实时共享 · 每人一票 · 文明投票</p></header>';
    // 统计
    const total=people.reduce(function(s,p){return s+(p.like_count||0);},0);
    h+='<div class="stats"><span>📸 候选人 '+people.length+'</span><span>🗳️ 累计 '+total+' 票</span><span>☁️ 全校实时共享</span></div>';
    // 上传（匿名也可传，带昵称/一句话）
    h+='<div class="panel">'
      +'<h3>📷 上传'+esc(C.title)+'照片（全校可见）</h3>'
      +'<div class="row"><input id="upName" maxlength="12" placeholder="* 请填写真实姓名"><input id="upMsg" maxlength="40" placeholder="一句话介绍（可选）"></div>'
      +'<div id="upDrop" class="up-drop"><input id="upFile" type="file" accept="image/*" multiple class="up-file"><div id="upHint">点选或拖拽照片到这里<br><small>支持 JPG / PNG / WEBP · 每张≤15MB · 每次最多 3 张 · 自动压缩 + 预审</small></div><div id="upPrev"></div></div>'
      +'<div id="upProg"><i></i></div>'
      +'<div class="row"><button class="btn" id="upGo">上传（自动压缩 + 预审）</button></div>'
      +'<p class="note">照片先本地预审 + AI 图像预审 + 云端人工复核后全校可见。同名照片自动归组为同一人。请仅上传本人或已获授权的素材，勿传他人隐私。</p>'
      +'</div>';
    // 投票墙
    h+='<h3 class="sec-title">🗳️ 投票 · 全校共享排名</h3>';
      h+='<div class="notice-box"><span class="nb-ico">📌</span>投票与肖像须知：每人一票，请理性参与、勿对特定同学施加舆论压力；照片请仅上传本人或已获授权的素材，被拍者可用卡片「申诉」申请删除。</div>';
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
        const noPhoto=!p._src;
        const phHTML=noPhoto
          ? avatarEl(p.id,p.nickname).outerHTML
          : '<img src="'+esc(p._src)+'" loading="lazy" alt="" data-cid="'+p.id+'" data-nm="'+esc(p.nickname||'')+'" onerror="window.__phFail(this)">';
        var thumbsHTML='';
        if(p._photos&&p._photos.length){
          thumbsHTML='<div class="ph-thumbs">'+p._photos.map(function(u){return '<img class="ph-thumb" src="'+esc(u)+'" loading="lazy" alt="">';}).join('')+'</div>';
        }
        h+='<div class="card" '+(p._photos&&p._photos.length?'data-multi="1"':'')+'>'
          +'<div class="ph" data-cid="'+p.id+'" data-nm="'+esc(p.nickname||'')+'">'+phHTML+'<span class="medal">'+medal+'</span>'+(p._photos&&p._photos.length?'<span class="ph-more">+'+p._photos.length+'</span>':'')+'</div>'
          +thumbsHTML
          +'<div class="body">'
          +'<div class="nm">'+esc(p.nickname||'匿名')+(p._photos&&p._photos.length?' <span class="tag-photo">'+(p._photos.length+1)+' 张照片</span>':'')+'</div>'
          +(p.msg?'<div class="ms">'+esc(p.msg)+'</div>':'')
          +'<div class="vf"><div class="vf-btns"><button class="vote '+(done?'done':'')+'" data-vote="'+p.id+'" '+((done||p.voting_on===false)?'disabled':'')+'>'+(p.voting_on===false?'投票已关闭':(done?'已投':'投票'))+'</button>'
          +'<button class="vote appeal" data-appeal="'+p.id+'">申诉</button></div>'
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
    const upFile=document.getElementById('upFile'), upPrev=document.getElementById('upPrev'), upHint=document.getElementById('upHint'),
      upDrop=document.getElementById('upDrop'), upProg=document.getElementById('upProg');
    let selFiles=[]; let prevUrls=[];
    function prog(p){ if(upProg){ upProg.firstElementChild.style.width=Math.min(100,Math.round(p))+'%'; } }
    function showPrevs(files){
      selFiles=Array.from(files||[]).slice(0,3);
      prevUrls.forEach(function(u){try{URL.revokeObjectURL(u);}catch(_){}}); prevUrls=[];
      if(upPrev) upPrev.innerHTML='';
      if(!selFiles.length){ if(upHint)upHint.style.display=''; return; }
      if(upHint)upHint.style.display='none';
      selFiles.forEach(function(f){
        var u; try{u=URL.createObjectURL(f);}catch(e){return;}
        prevUrls.push(u);
        var img=document.createElement('img');
        img.src=u; img.className='up-prev-img'; img.title='点我更换照片';
        img.addEventListener('click',function(){ upFile&&upFile.click(); });
        upPrev.appendChild(img);
      });
    }
    function clearSel(){ selFiles=[]; prevUrls.forEach(function(u){try{URL.revokeObjectURL(u);}catch(_){}}); prevUrls=[]; if(upFile)upFile.value=''; if(upPrev)upPrev.innerHTML=''; if(upHint)upHint.style.display=''; prog(0); }
    if(upFile) upFile.onchange=function(){ if(upFile.files.length>3) tip('一次最多 3 张，已取前 3 张'); showPrevs(upFile.files); };
    if(upDrop){
      upDrop.onclick=function(){ if(!selFiles.length) upFile&&upFile.click(); };
      ['dragenter','dragover'].forEach(function(ev){ upDrop.addEventListener(ev,function(e){ e.preventDefault(); upDrop.classList.add('drag'); }); });
      ['dragleave','drop'].forEach(function(ev){ upDrop.addEventListener(ev,function(e){ e.preventDefault(); upDrop.classList.remove('drag'); }); });
      upDrop.addEventListener('drop',function(e){ var fl=e.dataTransfer&&e.dataTransfer.files; if(fl&&fl.length){ showPrevs(fl); try{var dt=new DataTransfer(); Array.from(fl).slice(0,3).forEach(function(f){dt.items.add(f);}); upFile.files=dt.files;}catch(_){} } });
    }
    if(up){ up.onclick=function(){
      var nmEl=document.getElementById('upName'), msgEl=document.getElementById('upMsg');
      var nm=nmEl?nmEl.value.trim():'', msg=msgEl?msgEl.value.trim():'';
      if(!nm){ tip('请填写真实姓名（必填）'); if(nmEl)nmEl.focus(); return; }
      var files=upFile?upFile.files:null;
      if(files&&files.length){ selFiles=Array.from(files).slice(0,3); showPrevs(files); }
      if(!selFiles.length){ tip('请选择照片（最多 3 张）'); return; }
      var n=selFiles.length, done=0;
      up.disabled=true; up.textContent='预审 '+n+' 张照片…';
      var jobs=selFiles.map(function(f,ix){
        return preReview(f).then(function(rv){
          if(!rv.ok){ tip('第'+(ix+1)+'张：'+rv.reason); done++; prog((done/n)*100); return; }
          var autoReview=rv.pass?'pass':'review';
          var aiRun=(window.__nsfw&&window.__nsfw.reviewFile)?window.__nsfw.reviewFile(f):Promise.resolve({ok:false,verdict:'unknown',autoReview:'review'});
          return aiRun.then(function(ai){
            var aiRes=(ai&&ai.ok===true)?ai:null;
            if(aiRes&&aiRes.autoReview!=='pass')autoReview='review';
            return fileToBlob(f,720).then(function(blob){
              return uploadAndAdd(nm,msg,blob,autoReview,aiRes);
            }).then(function(){ done++; prog((done/n)*100); }).catch(function(e){ done++; prog((done/n)*100); tip('第'+(ix+1)+'张上传出错：'+(e&&e.message||e)); });
          });
        }).catch(function(e){ done++; prog((done/n)*100); });
      });
      Promise.all(jobs).then(function(){
        up.disabled=false; up.textContent='上传（自动压缩 + 预审）';
        tip('已上传 ✅ 同名照片自动归组，预审通过即全校可见');
        setTimeout(clearSel,800);
        loadCands().then(function(){ render(); }).catch(function(){ render(); });
      });
    }; }
    /* P3：卡片照片缩略条 —— 点击缩略图换主图 */
    document.querySelectorAll('.card[data-multi] .ph-thumb').forEach(function(t){
      t.onclick=function(){
        var card=t.closest('.card'); var main=card&&card.querySelector('.ph > img');
        if(!main)return;
        main.src=t.src;
        card.querySelectorAll('.ph-thumb').forEach(function(x){x.classList.remove('on');});
        t.classList.add('on');
      };
    });
    document.querySelectorAll('[data-vote]').forEach(function(b){
      b.onclick=function(){ vote(b.getAttribute('data-vote')); };
    });
    document.querySelectorAll('[data-appeal]').forEach(function(b){
      b.onclick=function(){ appeal(b.getAttribute('data-appeal')); };
    });
    const rt=document.getElementById('retryLoad');
    if(rt){ rt.onclick=function(){ if(typeof window.supabase==='undefined'){ location.reload(); return; } loading=false; loadCands().then(function(){ render(); }).catch(function(){ render(); }); }; }
    /* 照片看门狗：12s 内未成功/未失败的图片 → 自动换头像占位，杜绝永远"加载中" */
    document.querySelectorAll('img[data-cid]').forEach(function(img){
      if(img.complete && img.naturalWidth>0)return;
      setTimeout(function(){
        if(!img.complete || img.naturalWidth===0){ window.__phFail(img); }
      },12000);
    });
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
