/* assets/device-fp.js — 设备身份 + 云端 IP 哈希
   身份（window.__wallDevice.id）：每次安装唯一的随机 id，持久化在 localStorage。
     · v2 起不再直接用设备指纹当身份 —— 旧实现会让同型号手机撞成同一个 id，
       导致 like_wall 把第二个人的赞当成重复请求吞掉（详见 ensureId 注释）。
     · 写不进 localStorage 时才退回设备指纹，保证同一台设备至少每次一致。
   IP 维度来自 wall-fp Edge（取 X-Forwarded-For → 每日轮换 sha256(ip|salt|day) 截断），
     只回传哈希、不回传明文 IP（隐私友好）。
   暴露 window.__wallDevice = { id(), ip(), getIpHash(), ready() }
   全部 RPC 调用点用 __wallDevice.id() 作为 userKey，并传 p_ip=__wallDevice.ip()
*/
(function(){
  var SUPA='https://dpceuvqtwvhoipxhozxz.supabase.co';
  var ANON='sb_publishable_oBuCc6SrjzzsRQwa3CLjqQ_e5K2M_w3';
  var KEY_ID='wallDeviceId', KEY_IP='wallIpHash', KEY_VER='wallDeviceVer';
  var ID_VER='2';
  var id=null, ipHash='', readyP=null;

  function tz(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(e){ return ''; } }
  function scr(){ try{ return screen.width+'x'+screen.height+'x'+screen.colorDepth; }catch(e){ return ''; } }

  /* 设备指纹：由真实设备信号派生的稳定哈希。
     注意：它只作为【降级时的兜底】，不再直接当身份用 —— 见 ensureId 注释。 */
  function syncSeed(){
    var s=[navigator.userAgent,navigator.language,(navigator.hardwareConcurrency||0),scr(),tz()].join('|');
    var h=5381; for(var i=0;i<s.length;i++){ h=((h<<5)+h) ^ s.charCodeAt(i); }
    return 'd'+hex8(h>>>0);
  }
  function rand32(){
    try{ return (crypto.getRandomValues(new Uint32Array(1)))[0]>>>0; }catch(e){}
    return (Math.random()*4294967296)>>>0;
  }
  function hex8(n){ var h=(n>>>0).toString(16); while(h.length<8){ h='0'+h; } return h; }

  /* 身份生成 —— 这里换过一次实现，原因值得记下来：
     ----------------------------------------------------------------------
     旧实现直接用设备指纹当 id。五个输入（UA/语言/核心数/屏幕/时区）全是
     设备特征、没有随机量，于是【同型号的两台手机算出完全相同的 id】。
     而 like_wall 是按 u_key 去重的，结果就是：
         一个班 30 个用同款 iPhone 的同学 → 只有第 1 个能点赞，
         后 29 个都是幂等的 204（计数不变，界面上看起来"点了没反应"）。
     实测线上 818 次访问只换来 5 个赞、88% 的帖子零点赞，根因就在这里。

     新实现：能写 localStorage 就生成【每次安装唯一】的随机 id 并持久化；
     写不进去（隐私模式等）才退回指纹，保证同一台设备至少每次刷新一致。
     代价：清缓存会重置身份（可以重新点赞）。这个代价是故意接受的——
     对校园墙来说"一人一赞"比"不能靠清缓存重来"重要得多。
     ---------------------------------------------------------------------- */
  function ensureId(){
    if(id) return id;
    var stored='', ver='', canStore=true;
    try{
      stored=localStorage.getItem(KEY_ID)||'';
      ver=localStorage.getItem(KEY_VER)||'';
    }catch(e){ canStore=false; }

    /* 已经是新版身份 → 直接复用 */
    if(stored && ver===ID_VER && /^d[0-9a-f]{8}$/.test(stored)){ id=stored; return id; }

    /* 存储不可用 → 退回指纹：可能撞车，但至少稳定 */
    if(!canStore){ id=syncSeed(); return id; }

    /* 正常路径：每次安装生成一个唯一 id（格式与旧版一致，仍是 9 位） */
    var candidate='d'+hex8(rand32());
    var persisted=false;
    try{
      localStorage.setItem(KEY_ID,candidate);
      localStorage.setItem(KEY_VER,ID_VER);
      /* 写完必须读回来确认。隐私模式下 getItem 正常、只有 setItem 抛错，
         如果只靠 try/catch 判断，会误以为存成功了，结果每次刷新都换身份。 */
      persisted = localStorage.getItem(KEY_ID)===candidate
               && localStorage.getItem(KEY_VER)===ID_VER;
    }catch(e){ persisted=false; }

    /* 存不住 → 退回指纹，保证同一台设备每次加载拿到同一个 id */
    id = persisted ? candidate : syncSeed();
    return id;
  }

  /* 云端 IP 哈希（每日轮换，按天缓存） */
  function getIpHash(){
    var day=new Date().toISOString().slice(0,10);
    var stored=''; try{ stored=localStorage.getItem(KEY_IP)||''; }catch(e){}
    if(stored){ var p=stored.split(':'); if(p[0]===day){ ipHash=p[1]||''; return Promise.resolve(ipHash); } }
    return fetch(SUPA+'/functions/v1/wall-fp',{ headers:{ apikey:ANON, Authorization:'Bearer '+ANON } })
      .then(function(r){ return r.json(); })
      .then(function(j){
        ipHash=(j&&j.ok===true&&j.ip_hash)?j.ip_hash:'';
        if(ipHash){ try{ localStorage.setItem(KEY_IP,day+':'+ipHash); }catch(e){} }
        return ipHash;
      })
      .catch(function(){ ipHash=''; return ''; });
  }
  function ready(){
    if(!readyP){ readyP=(function(){ ensureId(); return getIpHash(); })(); }
    return readyP;
  }

  window.__wallDevice={
    id: ensureId,          // 同步稳定设备指纹（反重置）
    ip: function(){ return ipHash; },   // 同步，getIpHash() 之后有值
    getIpHash: getIpHash,
    ready: ready
  };
  ready(); // 加载即预热
})();
