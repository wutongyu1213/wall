/* assets/device-fp.js — S2 反刷加固：设备指纹 + 云端 IP 哈希
   身份从"易清的随机 localStorage 串"升级为"由浏览器特征派生的设备指纹"：
   - 清缓存/清 localStorage 不会重置身份（每次加载从真实设备信号重算，结果一致）
   - IP 维度来自 wall-fp Edge（取 X-Forwarded-For → 每日轮换 sha256(ip|salt|day) 截断），
     只回传哈希、不回传明文 IP（隐私友好）
   暴露 window.__wallDevice = { id(), ip(), getIpHash(), ready() }
   全部 RPC 调用点用 __wallDevice.id() 替代旧的随机 userKey，并传 p_ip=__wallDevice.ip()
*/
(function(){
  var SUPA='https://dpceuvqtwvhoipxhozxz.supabase.co';
  var ANON='sb_publishable_lgsJvhLEHOG9oM1aXH7y1A_pgdmezyA';
  var KEY_ID='wallDeviceId', KEY_IP='wallIpHash';
  var id=null, ipHash='', readyP=null;

  function tz(){ try{ return Intl.DateTimeFormat().resolvedOptions().timeZone||''; }catch(e){ return ''; } }
  function scr(){ try{ return screen.width+'x'+screen.height+'x'+screen.colorDepth; }catch(e){ return ''; } }

  /* 同步设备指纹：由真实设备信号派生的稳定哈希。清缓存不会改变结果 → 反重置 */
  function syncSeed(){
    var s=[navigator.userAgent,navigator.language,(navigator.hardwareConcurrency||0),scr(),tz()].join('|');
    var h=5381; for(var i=0;i<s.length;i++){ h=((h<<5)+h) ^ s.charCodeAt(i); }
    return 'd'+(h>>>0).toString(16).padStart(8,'0');
  }
  function ensureId(){
    if(id) return id;
    var stored=''; try{ stored=localStorage.getItem(KEY_ID)||''; }catch(e){}
    if(stored){ id=stored; return id; }
    id=syncSeed();
    try{ localStorage.setItem(KEY_ID,id); }catch(e){}
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
