/* assets/ai-review.js — P1-2 图像 AI 预审（NSFWjs · TensorFlow.js）
   浏览器本地推理：免费、无需 API key、图片不出域（隐私友好，契合大陆网络）
   输出 window.__nsfw.reviewFile(file) → Promise<result>
   result = { ok, model, verdict('safe'|'suspicious'|'risky'|'unknown'), risk(0-1), probs{...}, autoReview('pass'|'review') }
   - 模型从 jsDelivr 加载（大陆可达）；加载失败 → verdict=unknown → 强制人工(review)，安全兜底
   - 风险 = Porn + Hentai + Sexy 概率之和；safe(<0.3) 自动通过，其余强制人工预审
*/
(function(){
  var NSFW_CDN='https://cdn.jsdelivr.net/npm/@justadudewhohacks/nsfwjs@3.0.0/dist/index.min.js';
  var TF_CDN='https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js';
  var SAFE=0.3, RISKY=0.6;
  var model=null, loadP=null;

  function loadScript(src){ return new Promise(function(res,rej){
    var s=document.createElement('script'); s.src=src; s.onload=function(){res();}; s.onerror=function(){rej(new Error('cdn fail: '+src));};
    document.head.appendChild(s);
  }); }

  function ensure(){
    if(model) return Promise.resolve(model);
    if(loadP) return loadP;
    loadP=(async function(){
      if(typeof window.tf==='undefined') await loadScript(TF_CDN);
      if(typeof window.nsfwjs==='undefined') await loadScript(NSFW_CDN);
      if(!window.nsfwjs){ model=null; loadP=null; throw new Error('nsfwjs unavailable'); }
      model=await window.nsfwjs.load();          // 默认 MobileNet 模型
      return model;
    })().catch(function(e){ model=null; loadP=null; throw e; });
    return loadP;
  }

  function fileToImage(file){
    return new Promise(function(res,rej){
      var u; try{u=URL.createObjectURL(file);}catch(e){rej(e);return;}
      var im=new Image();
      im.onload=function(){ res({im:im,url:u}); };
      im.onerror=function(){ try{URL.revokeObjectURL(u);}catch(_){} rej(new Error('img load fail')); };
      im.src=u;
    });
  }

  /* 核心：对一个图片文件做 NSFW 分类，返回带 autoReview 的结果 */
  function reviewFile(file){
    if(!file){ return Promise.resolve({ok:false, model:false, verdict:'unknown', risk:0, probs:{}, autoReview:'review', reason:'no file'}); }
    return ensure().then(function(m){
      return fileToImage(file).then(function(o){
        var im=o.im, url=o.url;
        return m.classify(im).then(function(res){
          try{URL.revokeObjectURL(url);}catch(_){}
          var probs={}; var risk=0;
          (res||[]).forEach(function(x){ probs[x.className]=Number(x.probability||0);
            if(x.className==='Porn'||x.className==='Hentai'||x.className==='Sexy') risk+=Number(x.probability||0); });
          risk=Math.min(1,risk);
          var verdict, autoReview;
          if(risk<SAFE){ verdict='safe'; autoReview='pass'; }
          else if(risk>=RISKY){ verdict='risky'; autoReview='review'; }
          else { verdict='suspicious'; autoReview='review'; }
          return {ok:true, model:true, verdict:verdict, risk:risk, probs:probs, autoReview:autoReview};
        });
      });
    }).catch(function(e){
      return {ok:false, model:false, verdict:'unknown', risk:0, probs:{}, autoReview:'review', reason:String(e&&e.message||e)};
    });
  }

  window.__nsfw={ reviewFile:reviewFile, ensureModel:ensure, thresholds:{SAFE:SAFE,RISKY:RISKY} };
  // 不自动加载模型（省流量），首次 reviewFile 时才拉
  window.__nsfw.preload=function(){ try{ensure().catch(function(){});}catch(e){} };
})();
