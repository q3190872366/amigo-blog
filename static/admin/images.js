// images.js - 图片管理页面（GitHub 本地 + R2）
let curSource='github',allImgs=[],filteredImgs=[];
let isMobile=window.innerWidth<768;

if(!requireAuth()){}else{loadImages();syncModeBtn()}

function syncModeBtn(){
  const m=getStorageMode();
  const b=I('img-mode-btn');
  b.textContent=m==='r2'?'☁️ R2':'📁 GitHub';
  b.className='img-mode-btn'+(m==='r2'?' on':'');
}

function toggleStorageMode(){
  const m=getStorageMode()==='r2'?'github':'r2';
  setStorageMode(m);
  syncModeBtn();
  loadImages();
}

function swSource(s){
  curSource=s;
  document.querySelectorAll('.img-src-tab').forEach(x=>x.classList.toggle('on',x.dataset.src===s));
  I('img-info').textContent='0 张';
  loadImages();
}

async function loadImages(){
  I('img-grid').innerHTML='<div class="img-empty">加载中...</div>';
  I('img-info').textContent='0 张';
  allImgs=[];
  try{
    if(curSource==='r2'){
      await loadR2();
    }else{
      await loadGithub();
    }
    filterImages();
  }catch(e){
    let msg=e.message||'未知错误';
    // 检测是否为 R2 配置问题
    if(curSource==='r2' && (msg.includes('R2') || msg.includes('500') || msg.includes('凭据'))){
      I('img-grid').innerHTML=`<div class="img-empty"><div style="font-size:40px;margin-bottom:12px">☁️</div><div style="color:var(--r);font-weight:500">R2 加载失败</div><div style="margin-top:8px;font-size:13px;line-height:1.6">${esc(msg)}</div><div style="margin-top:12px;font-size:12px;color:var(--m)">请检查 Cloudflare Pages 环境变量：<br>R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_ACCOUNT_ID</div><button class="btn btn-sm" onclick="swSource('github')" style="margin-top:16px">切换到 GitHub</button></div>`;
    }else{
      I('img-grid').innerHTML='<div class="img-empty">加载失败: '+esc(msg)+'</div>';
    }
  }
}

async function loadR2(){
  try{
    const r=await fetch('/api/r2/list',{signal:AbortSignal.timeout(10000)});
    const d=await r.json();
    if(!r.ok) throw new Error(d.message||('HTTP '+r.status));
    if(!Array.isArray(d)) throw new Error('R2 返回格式错误');
    if(d.length===0){
      allImgs=[];
      return;
    }
    allImgs=d.map(x=>({
      name:x.key.split('/').pop()||x.key,
      key:x.key,
      url:'/api/r2/img?key='+encodeURIComponent(x.key),
      size:x.size,
      source:'r2',
      lastModified:x.lastModified
    }));
  }catch(e){
    // 网络错误时给出友好提示
    if(e.name==='TimeoutError'){
      throw new Error('请求超时，请检查网络连接');
    }
    throw e;
  }
}

async function loadGithub(){
  try{
    const f=await gh('/contents/static/posts/images');
    for(const x of f)
      if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name)){
        const u=LOCAL?'/api/raw/static/posts/images/'+encodeURIComponent(x.name):CDN+'/static/posts/images/'+x.name;
        allImgs.push({name:x.name,url:u,size:0,source:'github',path:x.path,sha:x.sha});
      }
  }catch(_){}
  try{
    const ps=await gh('/contents/'+PP);
    for(const p of ps){
      if(p.type!=='dir')continue;
      try{
        const fs=await gh('/contents/'+ghp(PP+'/'+p.name));
        for(const x of fs)
          if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name)){
            const u=LOCAL?'/api/raw/'+PP+'/'+p.name+'/'+encodeURIComponent(x.name):CDN+'/'+PP+'/'+p.name+'/'+x.name;
            allImgs.push({name:x.name,url:u,size:x.size||0,source:'github',path:x.path,sha:x.sha,post:p.name});
          }
      }catch(_){}
    }
  }catch(_){}
}

function filterImages(){
  const q=(I('img-search').value||'').toLowerCase();
  filteredImgs=allImgs.filter(x=>x.name.toLowerCase().includes(q));
  I('img-info').textContent=filteredImgs.length+' 张';
  renderPage(0);
}

let curPage=0;const PS=isMobile?30:24;

function renderPage(p){
  curPage=p;
  const s=p*PS,pi=filteredImgs.slice(s,s+PS),tp=Math.ceil(filteredImgs.length/PS);
  if(!pi.length){
    I('img-grid').innerHTML='<div class="img-empty">'+(curSource==='r2'?'R2 中暂无图片':'没有图片')+'</div>';
    I('img-page').innerHTML='';
    return;
  }
  I('img-grid').innerHTML=pi.map((x,i)=>{
    const un=esc(x.name),ix=s+i;
    return `<div class="img-card" onclick="openPreview(${ix})"><img src="${x.url}" alt="${un}" loading="lazy" onerror="this.outerHTML='<div class=\'img-error\'>加载失败</div>'"><div class="img-card-body"><div class="img-card-name" title="${un}">${un}</div></div></div>`;
  }).join('');
  if(tp>1){
    let pg='';
    for(let i=0;i<tp;i++)pg+=`<button class="${i===p?'on':''}" onclick="renderPage(${i})">${i+1}</button>`;
    I('img-page').innerHTML=pg;
  }else{
    I('img-page').innerHTML='';
  }
}

function openPreview(i){
  if(i<0||i>=filteredImgs.length)return;
  const x=filteredImgs[i];
  I('img-preview').classList.add('on');
  I('img-preview-img').src=x.url;
  const sizeInfo=x.size?' · '+fmtSize(x.size):'';
  const sourceBadge=x.source==='r2'?'<span style="color:#10b981">R2</span>':'<span>GitHub</span>';
  I('img-preview-info').innerHTML=`<span>${esc(x.name)}${sizeInfo}</span>${sourceBadge}<div class="img-preview-actions"><button onclick="event.stopPropagation();copyUrl(${i})">复制链接</button><button onclick="event.stopPropagation();window.open(filteredImgs[${i}].url,'_blank')">新窗口</button>${x.source==='github'?'<button class="danger" onclick="event.stopPropagation();delImg('+i+')">删除</button>':''}</div>`;
}

function closePreview(){I('img-preview').classList.remove('on')}

function copyUrl(i){
  const u=filteredImgs[i]?.url;
  if(!u)return;
  navigator.clipboard.writeText(u).then(()=>T('已复制','ok')).catch(()=>{
    const ta=document.createElement('textarea');
    ta.value=u;document.body.appendChild(ta);ta.select();
    document.execCommand('copy');document.body.removeChild(ta);
    T('已复制','ok');
  });
}

async function handleUpload(f){
  if(!f||!f.length)return;
  if(curSource==='r2'){
    await uploadToR2(f);
  }else{
    await uploadToGithub(f);
  }
}

async function uploadToGithub(f){
  const cp=I('img-compress').checked,wp=I('img-webp').checked,q=parseInt(I('img-quality').value)||82,mw=cp?1600:9999;
  for(const x of f){
    try{
      T('上传中: '+x.name,'info');
      const{blob,ext}=await compImg(x,mw,q/100,wp);
      const bn='img-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+ext;
      const rd=new FileReader();
      const c=await new Promise((ok,no)=>{rd.onload=()=>ok(rd.result.split(',')[1]);rd.onerror=no;rd.readAsDataURL(blob)});
      await gh('/contents/'+ghp('static/posts/images/'+bn),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bn,content:c,branch:B})});
      T('已上传: '+bn,'ok');
    }catch(e){T('失败: '+e.message,'err')}
  }
  loadImages();
}

async function uploadToR2(f){
  for(const x of f){
    try{
      T('上传到 R2: '+x.name,'info');
      const r2r=await r2Upload(x);
      T('已上传 R2: '+r2r.name,'ok');
    }catch(e){T('R2 失败: '+e.message,'err')}
  }
  loadImages();
}

async function delImg(i){
  const x=filteredImgs[i];
  if(!x||x.source!=='github'||!x.sha)return;
  if(!confirm('确定删除 '+x.name+'？'))return;
  try{
    await gh('/contents/'+ghp(x.path),{method:'DELETE',body:JSON.stringify({message:'admin: delete '+x.name,sha:x.sha,branch:B})});
    T('已删除','ok');
    loadImages();
  }catch(e){T('失败: '+e.message,'err')}
}

function fmtSize(b){if(b<1024)return b+'B';if(b<1048576)return Math.round(b/1024)+'KB';return(b/1048576).toFixed(1)+'MB'}

// 监听窗口大小变化
window.addEventListener('resize',()=>{
  const nowMobile=window.innerWidth<768;
  if(nowMobile!==isMobile){
    isMobile=nowMobile;
    PS=isMobile?30:24;
    if(!I('img-grid').classList.contains('img-empty')){
      renderPage(0);
    }
  }
});

document.addEventListener('keydown',e=>{if(e.key==='Escape')closePreview()});
