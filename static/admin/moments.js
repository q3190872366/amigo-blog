// moments.js - 发布动态页面逻辑
let momImgs=[];       // [{name,url,path,kind:'new'|'lib'}]
let momSlug='';       // 当前动态的目录名（图片上传用）
let momLibImgs=[];    // 媒体库缓存
let momLibFiltered=[]; // 媒体库过滤后的列表
let momTags=[];       // 选中的标签数组
let momAllTags=[];    // 所有可用标签
let momTitle='';      // 动态标题
let momLocation='';   // 选中的位置
let _momTopTimer=null;
let momActiveTab='normal'; // 当前选中的图片 Tab
let editingSlug='';   // 编辑模式的动态 slug
let editingSha=null;  // 编辑模式的文件 sha

// 顶部状态条（上传进度显示）
function momTopBar(msg){
  const el=I('mom-topbar');
  if(!el)return;
  if(!msg){el.innerHTML='';return}
  el.innerHTML='<div>'+esc(msg)+'</div>';
  if(_momTopTimer)clearTimeout(_momTopTimer);
  _momTopTimer=setTimeout(()=>{el.innerHTML=''},3000);
}

// 鉴权检查（未登录跳回首页）
if(!requireAuth()){
  // 不再继续执行
}else{
  // 检查是否为编辑模式
  const editParam=new URLSearchParams(location.search).get('edit');
  if(editParam){
    editingSlug=editParam;
    loadMomentForEdit(editingSlug);
  }else{
    momSlug=nowSlug();
    loadTags();
  }
}

// 加载动态内容进行编辑
async function loadMomentForEdit(slug){
  try{
    const path=PP+'/'+slug+'/index.md';
    const f=await gh('/contents/'+ghp(path));
    editingSha=f.sha;
    const raw=b64d(f.content);
    const m=raw.match(/^---\n([\s\S]*?)\n---/);
    const body=m?raw.replace(/^---\n[\s\S]*?\n---\n/,''):raw;
    const fm=m?parseFM(raw):{};
    
    // 填充正文
    I('mom-text').value=body.trim();
    onText();
    
    // 填充标题
    if(fm.title){
      I('mom-title').value=fm.title;
      momTitle=fm.title;
    }
    
    // 填充标签
    if(fm.tags){
      momTags=Array.isArray(fm.tags)?fm.tags:[fm.tags];
      renderTags();
    }
    
    // 填充位置
    if(fm.location){
      momLocation=fm.location;
      I('mom-loc-text').textContent=fm.location;
    }
    
    // 解析正文中的图片引用
    momImgs=[];
    const imgRegex=/!\[([^\]]*)\]\(([^)]+)\)/g;
    let match;
    while((match=imgRegex.exec(body))!==null){
      const alt=match[1];
      const url=match[2];
      const name=url.split('/').pop().split('?')[0];
      // 判断图片类型
      if(url.includes('livephoto')){
        const liveMatch=body.match(/livephoto image="([^"]*)" video="([^"]*)"/);
        if(liveMatch){
          momImgs.push({name:alt||name,kind:'livephoto',imgUrl:liveMatch[1],vidUrl:liveMatch[2]});
          continue;
        }
      }
      if(url.includes('/api/r2/')){
        momImgs.push({name:alt||name,url:url,kind:'r2'});
      }else if(url.match(/^vid-/)){
        momImgs.push({name:alt||name,url:url,kind:'r2-video'});
      }else{
        // 检查是否为视频 shortcode
        const videoMatch=body.match(/\{\{<\s*video\s+src="([^"]*)"\s*>\}\}/);
        if(videoMatch){
          momImgs.push({name:alt||name,url:videoMatch[1],kind:'r2-video'});
        }else{
          momImgs.push({name:alt||name,url:url,kind:'lib'});
        }
      }
    }
    renderMomImgs();
    
    // 切换到编辑模式的UI
    I('mom-publish').textContent='保存修改';
    document.querySelector('.mom-title').textContent='编辑动态';
    momSlug=slug; // 使用原slug，确保图片上传到正确目录
    
    T('已加载动态内容','ok');
  }catch(e){
    T('加载失败: '+e.message,'err');
    setTimeout(()=>location.href='index.html',1500);
  }
}

// 文本变化
function onText(){
  const t=I('mom-text').value;
  I('mom-cnt').textContent=t.length+' / 2000';
  I('mom-cnt').classList.toggle('warn',t.length>1800);
  I('mom-publish').disabled=!t.trim()&&!momImgs.length;
}

// 取消
function cancelMoment(){
  if((I('mom-text').value.trim()||momImgs.length)&&!confirm('确定放弃这条动态？'))return;
  location.href='index.html';
}

// 加载所有标签（从已有动态的 tags/categories 收集）
async function loadTags(){
  try{
    const data=await gh('/contents/'+PP);
    const tags=new Set();
    for(const it of data){
      if(it.type!=='dir')continue;
      try{
        const f=await gh('/contents/'+ghp(PP+'/'+it.name+'/index.md'));
        const fm=parseFM(b64d(f.content));
        if(fm.type==='moment'||!fm.type){
          if(Array.isArray(fm.tags))fm.tags.forEach(t=>tags.add(t));
          if(Array.isArray(fm.categories))fm.categories.forEach(c=>tags.add(c));
        }
      }catch(_){}
    }
    momAllTags=Array.from(tags).slice(0,50);
    renderTags();
  }catch(_){}
}

// 渲染标签
function renderTags(){
  const list=I('mom-tags-list');
  const input=I('mom-tag-input');
  if(!list)return;
  
  // 显示已选标签
  list.innerHTML=momTags.map(t=>
    '<span class="mom-tag-item" onclick="removeTag(\''+esc(t)+'\')">'+
      esc(t)+
      '<span class="remove">×</span>'+
    '</span>'
  ).join('');
  
  // 更新建议标签
  if(input){
    const existing=document.querySelector('.mom-suggestions');
    const newSuggestions=momAllTags.filter(t=>!momTags.includes(t));
    if(existing)existing.remove();
    if(newSuggestions.length){
      const wrap=I('mom-tags-wrap');
      const div=document.createElement('div');
      div.className='mom-suggestions';
      div.innerHTML='<span style="font-size:12px;color:var(--m);margin-right:4px">常用标签:</span>'+
        newSuggestions.slice(0,10).map(t=>
          '<span class="mom-suggestion" onclick="addTag(\''+esc(t)+'\')">'+esc(t)+'</span>'
        ).join('');
      wrap.appendChild(div);
    }
  }
}

// 添加标签
function addTag(tag){
  if(!tag)return;
  tag=tag.trim();
  if(!tag)return;
  if(momTags.includes(tag))return;
  if(momTags.length>=10){T('最多添加10个标签','err');return}
  momTags.push(tag);
  const input=I('mom-tag-input');
  if(input)input.value='';
  renderTags();
  onText();
}

// 移除标签
function removeTag(tag){
  momTags=momTags.filter(t=>t!==tag);
  renderTags();
  onText();
}

// 标签输入框回车添加
function onTagInput(e){
  if(e.key==='Enter'||e.key===','){
    e.preventDefault();
    const input=I('mom-tag-input');
    if(input&&input.value.trim()){
      addTag(input.value.trim());
    }
  }
}

// 简易 front matter 解析
function parseFM(raw){const m=raw.match(/^---\n([\s\S]*?)\n---/);if(!m)return{};const fm={};let ck=null;m[1].split('\n').forEach(l=>{const a=l.match(/^\s+-\s+(.*)/);if(a&&ck){fm[ck]=fm[ck]||[];fm[ck].push(a[1].trim().replace(/^['"]|['"]$/g,''));return}const kv=l.match(/^(\w+):\s*(.*)/);if(kv){const v=kv[2].trim();fm[kv[1]]=v==='true'?true:v==='false'?false:v.replace(/^['"]|['"]$/g,'');ck=v===''||v==='[]'?kv[1]:null}});return fm}

// 工具栏格式化
function doFmt(t){
  const e=I('mom-text'),s=e.selectionStart,ed=e.selectionEnd,sel=e.value.substring(s,ed);
  let b=e.value.substring(0,s),a=e.value.substring(ed),ls=b.lastIndexOf('\n')+1;
  switch(t){
    case'undo':document.execCommand('undo');return;
    case'redo':document.execCommand('redo');return;
    case'bold':b+='**';a='**'+a;break;
    case'italic':b+='*';a='*'+a;break;
    case'underline':b+='<u>';a='</u>'+a;break;
    case'strike':b+='~~';a='~~'+a;break;
    case'h':b+='#';a=''+a;break;
    case'link':{const u=prompt('链接 URL:');if(u){b+='['+(sel||'链接文字')+']('+u+')';a=')'+a}}break;
    case'emoji':{const em=prompt('表情符号（可粘贴 😊/🔥/❤️/🎉 等）:');if(em){b+=em}}break;
  }
  e.value=b+(sel||'')+a;
  e.focus();
  onText();
}

// 图片标签切换
function swMomImgTab(t){
  momActiveTab=t;
  document.querySelectorAll('.mom-img-tab').forEach(x=>x.classList.toggle('on',x.dataset.tab===t));
  const addBtn=I('mom-img-add');
  const hint=I('mom-img-hint');
  if(t==='video'){
    addBtn.onclick=()=>I('mom-video-file').click();
    hint.textContent='点击添加视频';
    I('mom-img-file').value='';
    I('mom-live-file').value='';
  }else if(t==='live'){
    addBtn.onclick=()=>I('mom-live-file').click();
    hint.textContent='支持多选（可同时选 JPG + MOV 自动配对；Android 可选动态照片单文件）';
    I('mom-img-file').value='';
    I('mom-video-file').value='';
  }else if(t==='real'){
    addBtn.onclick=()=>I('mom-img-file').click();
    hint.textContent='上传原图（不压缩，保留真实画质）';
    I('mom-video-file').value='';
    I('mom-live-file').value='';
  }else{
    addBtn.onclick=()=>I('mom-img-file').click();
    hint.textContent='点击添加图片';
    I('mom-video-file').value='';
    I('mom-live-file').value='';
  }
}

// 图片上传
async function momImgUpload(files){
  if(!files||!files.length)return;
  const mode=getStorageMode();
  if(mode==='r2'){
    const status={set textContent(v){momTopBar(v)}};
    for(const file of files){try{
      status.textContent='上传到 R2: '+file.name;
      const r2r=await r2Upload(file);
      momImgs.push({name:r2r.name,url:r2r.url,kind:'r2'});
      renderMomImgs();
      status.textContent='R2: '+r2r.name;
      onText();
    }catch(e){status.textContent='R2 失败: '+e.message}}
    return;
  }
  const status={set textContent(v){momTopBar(v)}};
  const noCompress=(momActiveTab==='real');
  for(const file of files){
    try{
      status.textContent=(noCompress?'上传原图: ':'上传中: ')+file.name;
      let blob,ext;
      if(noCompress){
        blob=file;
        const origExt=file.name.split('.').pop().toLowerCase();
        ext=(/^(jpe?g|png|gif|webp)$/i.test(origExt)?'.'+origExt:'.jpg');
      }else{
        ({blob,ext}=await compImg(file,1600,0.82,true));
      }
      const bn='img-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+ext;
      const r=new FileReader();
      const content=await new Promise((ok,no)=>{r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(blob)});
      const path=PP+'/'+momSlug+'/'+bn;
      await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bn,content,branch:B})});
      const url=LOCAL?'/api/raw/'+path:CDN+'/'+path;
      momImgs.push({name:bn,url,path,kind:'new'});
      renderMomImgs();
      status.textContent='已上传: '+bn;
      onText();
    }catch(e){status.textContent='上传失败: '+e.message}
  }
}

// 短视频上传（未压缩原片上传到当前动态目录 + 插入 video 短代码）
async function momVideoUpload(files){
  if(!files||!files.length)return;
  const mode=getStorageMode();
  const status={set textContent(v){momTopBar(v)}};
  for(const file of files){
    try{
      status.textContent='上传视频: '+file.name;
      const bn='vid-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+'.'+(file.name.split('.').pop()||'mp4');
      const r2r=await r2Upload(file);
      momImgs.push({name:bn,url:r2r.url,kind:'r2-video'});
      renderMomImgs();
      status.textContent='视频已上传: '+bn;
      onText();
    }catch(e){
      if(mode==='r2'){status.textContent='视频失败: '+e.message;continue}
      // GitHub 模式
      const ext=file.name.split('.').pop().toLowerCase()||'mp4';
      const bn='vid-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+'.'+ext;
      const rd=new FileReader();
      const content=await new Promise((ok,no)=>{rd.onload=()=>ok(rd.result.split(',')[1]);rd.onerror=no;rd.readAsDataURL(file)});
      const path=PP+'/'+momSlug+'/'+bn;
      await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bn,content,branch:B})});
      const url=LOCAL?'/api/raw/'+path:CDN+'/'+path;
      momImgs.push({name:bn,url,path,kind:'new-video'});
      renderMomImgs();
      status.textContent='视频已上传: '+bn;
      onText();
    }
  }
}

// 实况图上传：自动配对 image + video（同 basename 不同后缀）
async function momLiveUpload(files){
  if(!files||!files.length)return;
  const status={set textContent(v){momTopBar(v)}};
  // Step 1: 尝试 Android 单文件 Motion Photo 提取
  const groups = new Map();
  for(const f of files){
    status.textContent='分析: '+f.name;
    // 先尝试客户端提取内嵌视频（Android Motion Photo）
    const extracted = await extractMotionPhoto(f);
    if(extracted){
      status.textContent='提取实况图: '+f.name;
      const base = f.name.replace(/\.[^.]+$/,'');
      groups.set(base, {img: new File([extracted.imageBlob], base+'.jpg', {type:'image/jpeg'}), vid: extracted.videoBlob?new File([extracted.videoBlob], base+'.mp4', {type:'video/mp4'}):null, extracted:true});
      continue;
    }
    // 没有内嵌视频 → 按扩展名手动配对
    const ext = f.name.split('.').pop().toLowerCase();
    const base = f.name.replace(/\.[^.]+$/,'');
    const isVideo = /^(mp4|mov|webm|m4v)$/i.test(ext);
    const isImage = /^(jpe?g|png|webp|heic|heif)$/i.test(ext);
    if(!isVideo && !isImage){status.textContent='跳过不支持的文件: '+f.name;continue}
    if(!groups.has(base))groups.set(base,{img:null,vid:null,extracted:false});
    const g = groups.get(base);
    if(isVideo)g.vid=f; else g.img=f;
  }
  // Step 2: 上传每组
  for(const [base, g] of groups){
    try{
      status.textContent='实况图: '+base+(g.extracted?' [提取]':'');
      if(!g.img){status.textContent='缺图片: '+base;continue}
      let imgUrl, vidUrl;
      const mode=getStorageMode();
      if(mode==='r2'){
        const r2r=await r2Upload(g.img);
        imgUrl=r2r.url;
        if(g.vid){const r2v=await r2Upload(g.vid);vidUrl=r2v.url}
      }else{
        // GitHub 模式
        const extI=g.img.name.split('.').pop().toLowerCase();
        const bnI='img-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+'.'+extI;
        const rdI=new FileReader();
        const cI=await new Promise((ok,no)=>{rdI.onload=()=>ok(rdI.result.split(',')[1]);rdI.onerror=no;rdI.readAsDataURL(g.img)});
        const pathI=PP+'/'+momSlug+'/'+bnI;
        await gh('/contents/'+ghp(pathI),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bnI,content:cI,branch:B})});
        imgUrl=LOCAL?'/api/raw/'+pathI:CDN+'/'+pathI;
        if(g.vid){
          const extV=g.vid.name.split('.').pop().toLowerCase();
          const bnV='vid-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+'.'+extV;
          const rdV=new FileReader();
          const cV=await new Promise((ok,no)=>{rdV.onload=()=>ok(rdV.result.split(',')[1]);rdV.onerror=no;rdV.readAsDataURL(g.vid)});
          const pathV=PP+'/'+momSlug+'/'+bnV;
          await gh('/contents/'+ghp(pathV),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bnV,content:cV,branch:B})});
          vidUrl=LOCAL?'/api/raw/'+pathV:CDN+'/'+pathV;
        }
      }
      momImgs.push({name:base,kind:'livephoto',imgName:g.img.name,vidName:g.vid?g.vid.name:null,imgUrl,vidUrl});
      renderMomImgs();
      status.textContent='实况图已上传: '+(g.vid?base+'(图+视频)':base+'(仅图)')+(g.extracted?' [自动提取]':'');
      onText();
    }catch(e){status.textContent='实况图失败: '+e.message}
  }
}

// 渲染图片列表
function renderMomImgs(){
  const list=I('mom-img-list');
  // 重建 - 保留 add 按钮
  list.innerHTML='<div class="mom-img-add" id="mom-img-add" onclick="document.getElementById(\'mom-img-file\').click()">'+
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>'+
    '<div class="mom-img-hint" id="mom-img-hint">点击添加图片</div>';
  // 同步 hint
  const activeTab=document.querySelector('.mom-img-tab.on')?.dataset.tab||'normal';
  const hint=I('mom-img-hint');
  if(activeTab==='video')hint.textContent='点击添加视频';
  else if(activeTab==='live')hint.textContent='支持多选（可同时选 JPG + MOV 自动配对）';
  else if(activeTab==='real')hint.textContent='上传原图（不压缩，保留真实画质）';
  else hint.textContent='点击添加图片';
  // 同步 add 按钮 onclick
  const addBtn=I('mom-img-add');
  if(activeTab==='video')addBtn.onclick=()=>I('mom-video-file').click();
  else if(activeTab==='live')addBtn.onclick=()=>I('mom-live-file').click();
  else addBtn.onclick=()=>I('mom-img-file').click();
  momImgs.forEach((img,i)=>{
    const d=document.createElement('div');
    d.className='mom-img-item'+(img.kind==='livephoto'?' live':'')+(img.kind==='r2-video'||img.kind==='new-video'?' video':'');
    let thumb=img.url;
    let badge='';
    if(img.kind==='livephoto'){
      thumb=img.imgUrl||img.url;
      badge=img.vidUrl?'<span class="badge">实况</span>':'<span class="badge">图</span>';
    }else if(img.kind==='r2-video'||img.kind==='new-video'){
      thumb=''; // 没有缩略图
      badge='<span class="badge">视频</span>';
    }
    d.innerHTML='<img src="'+(thumb||'')+'" alt="'+esc(img.name||'')+'" loading="lazy">'+
      badge+
      '<button class="del" onclick="momDelImg('+i+')" aria-label="删除">✕</button>';
    list.appendChild(d);
  });
}

// 删除图片
async function momDelImg(i){
  const img=momImgs[i];
  if(!img)return;
  // 仅删除本地引用，GitHub 上的文件保留（避免误删）
  momImgs.splice(i,1);
  renderMomImgs();
  onText();
}

// 媒体库
let momLibTab='all'; // all / r2 / github
async function openMomLib(){
  I('mom-lib').classList.add('on');
  I('mom-lib-q').value='';
  // 显示标签页
  const tabs=I('mom-lib-tabs');
  if(tabs)tabs.style.display='flex';
  if(!momLibImgs.length)await refreshMomLib();
  else filterMomLib();
}

function closeMomLib(){I('mom-lib').classList.remove('on')}

function swMomLibTab(t){
  momLibTab=t;
  document.querySelectorAll('.mom-lib-tab-item').forEach(x=>x.classList.toggle('on',x.dataset.tab===t));
  filterMomLib();
}

async function refreshMomLib(){
  const grid=I('mom-lib-grid');
  grid.innerHTML='<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--m)">加载中...</div>';
  momLibImgs=[];
  
  // 根据存储模式决定默认标签
  const mode=getStorageMode();
  if(!momLibImgs.length){
    try{
      // 加载 R2 图片
      if(mode==='r2'||momLibTab==='all'||momLibTab==='r2'){
        try{
          const r=await fetch('/api/r2/list',{signal:AbortSignal.timeout(10000)});
          const d=await r.json();
          if(Array.isArray(d)){
            const r2Imgs=d.map(x=>({
              name:x.key.split('/').pop()||x.key,
              key:x.key,
              url:'/api/r2/img?key='+encodeURIComponent(x.key),
              source:'r2',
              path:x.key
            }));
            if(mode==='r2')momLibTab='r2';
            momLibImgs.push(...r2Imgs);
          }
        }catch(e){
          // R2 加载失败，忽略错误
          console.warn('R2 images load failed:',e.message);
        }
      }
      
      // 加载 GitHub 图片
      if(mode==='github'||momLibTab==='all'||momLibTab==='github'){
        try{
          // 扫描公共图片目录
          const files=await gh('/contents/static/posts/images');
          const githubImgs=files.filter(f=>/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name)).map(f=>({
            name:f.name,
            url:LOCAL?'/api/raw/static/posts/images/'+encodeURIComponent(f.name):CDN+'/static/posts/images/'+f.name,
            path:'static/posts/images/'+f.name,
            source:'github'
          }));
          momLibImgs.push(...githubImgs);
        }catch(e){
          console.warn('GitHub static images load failed:',e.message);
        }
        
        // 扫描所有动态目录下的图片
        try{
          const posts=await gh('/contents/'+PP);
          for(const p of posts){
            if(p.type!=='dir')continue;
            try{
              const fs=await gh('/contents/'+ghp(PP+'/'+p.name));
              const postImgs=fs.filter(f=>/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name)).map(f=>({
                name:f.name,
                url:LOCAL?'/api/raw/'+PP+'/'+p.name+'/'+encodeURIComponent(f.name):CDN+'/'+PP+'/'+p.name+'/'+f.name,
                path:PP+'/'+p.name+'/'+f.name,
                source:'github',
                post:p.name
              }));
              momLibImgs.push(...postImgs);
            }catch(_){}
          }
        }catch(e){
          console.warn('GitHub post images load failed:',e.message);
        }
      }
      
      // 如果当前标签没有加载到任何图片，切换到对应标签
      if(momLibTab!=='all'){
        const hasCurrentTab=momLibImgs.some(x=>x.source===momLibTab);
        if(!hasCurrentTab&&mode==='r2'){
          momLibTab='r2';
          document.querySelectorAll('.mom-lib-tab-item').forEach(x=>x.classList.toggle('on',x.dataset.tab==='r2'));
        }else if(!hasCurrentTab&&mode==='github'){
          momLibTab='github';
          document.querySelectorAll('.mom-lib-tab-item').forEach(x=>x.classList.toggle('on',x.dataset.tab==='github'));
        }
      }
      
      filterMomLib();
    }catch(e){
      grid.innerHTML='<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--m)">加载失败: '+e.message+'</div>';
    }
  }
}

function filterMomLib(){
  const q=(I('mom-lib-q').value||'').toLowerCase();
  let fl=momLibImgs;
  
  // 根据当前标签过滤
  if(momLibTab==='r2')fl=fl.filter(x=>x.source==='r2');
  else if(momLibTab==='github')fl=fl.filter(x=>x.source==='github');
  
  // 搜索过滤
  if(q)fl=fl.filter(x=>x.name.toLowerCase().includes(q));
  
  // 存储当前过滤后的列表供 pick 使用
  momLibFiltered=fl;
  
  const grid=I('mom-lib-grid');
  const info=I('mom-lib-info');
  if(info)info.textContent=fl.length+' 张图片';
  
  if(!fl.length){
    grid.innerHTML='<div style="grid-column:1/-1;padding:30px 20px;text-align:center;color:var(--m)"><div style="font-size:36px;margin-bottom:8px">🖼️</div>'+
      (momLibTab==='r2'?'R2 中暂无图片':momLibTab==='github'?'暂无 GitHub 图片':'没有找到图片')+'</div>';
    return;
  }
  
  grid.innerHTML=fl.map((x,i)=>{
    const srcBadge=x.source==='r2'?'<span class="lib-badge r2">R2</span>':'<span class="lib-badge gh">Git</span>';
    const imgHtml='<img src="'+x.url+'" alt="'+esc(x.name)+'" loading="lazy">';
    return '<div class="lib-item" onclick="pickLibByIndex('+i+')">'+
      imgHtml+
      srcBadge+
      '<div class="nm">'+esc(x.name)+'</div>'+
    '</div>';
  }).join('');
}

function pickLibByIndex(i){
  const x=momLibFiltered[i];
  if(!x)return;
  if(x.source==='r2'){
    momImgs.push({name:x.name,url:x.url,kind:'r2'});
  }else{
    momImgs.push({name:x.name,url:x.url,path:x.path,kind:'lib'});
  }
  renderMomImgs();
  closeMomLib();
  T('已添加: '+x.name,'ok');
  onText();
}

function pickLibImg(name){
  const url=LOCAL?'/api/raw/static/posts/images/'+encodeURIComponent(name):CDN+'/static/posts/images/'+name;
  momImgs.push({name,url,path:'static/posts/images/'+name,kind:'lib'});
  renderMomImgs();
  closeMomLib();
  T('已添加: '+name,'ok');
  onText();
}

// ======== 位置功能 ========
function pickLocation(){
  I('mom-loc-picker').classList.add('on');
  if(momLocation)I('mom-loc-input').value=momLocation;
}
function closeLocPicker(){
  I('mom-loc-picker').classList.remove('on');
}
function pickByGPS(){
  if(!navigator.geolocation){T('浏览器不支持定位','err');return}
  T('正在获取位置...','info');
  navigator.geolocation.getCurrentPosition(
    pos=>{
      const{latitude,longitude}=pos.coords;
      I('mom-loc-input').value=`${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
      T('已获取坐标','ok');
    },
    err=>{T('定位失败: '+err.message,'err')},
    {enableHighAccuracy:true,timeout:10000}
  );
}
function saveLocation(){
  const v=(I('mom-loc-input').value||'').trim();
  if(!v){closeLocPicker();return}
  momLocation=v;
  I('mom-loc-text').textContent=v;
  closeLocPicker();
  T('位置已保存','ok');
}

// 发表 / 保存修改
async function publishMoment(){
  const text=I('mom-text').value.trim();
  if(!text&&!momImgs.length){T('请输入内容','err');return}
  const btn=I('mom-publish');
  btn.disabled=true;
  btn.textContent=editingSlug?'保存中...':'发表中...';
  I('mom-status').textContent=editingSlug?'正在保存修改...':'正在发表...';
  try{
    const slug=momSlug;
    const path=PP+'/'+slug+'/index.md';
    let body=text;

    // 处理图片：每张都确保在当前动态目录下
    for(let i=0;i<momImgs.length;i++){
      const img=momImgs[i];
      if(img.kind==='r2'){
        body+='\n\n!['+(img.name.replace(/\.[^.]+$/,''))+']('+img.url+')';
        continue;
      }
      if(img.kind==='livephoto'){
        if(img.vidUrl){
          body+='\n\n{{< livephoto image="'+img.imgUrl+'" video="'+img.vidUrl+'" >}}';
        }else{
          body+='\n\n!['+esc(img.name)+']('+img.imgUrl+')';
        }
        continue;
      }
      if(img.kind==='r2-video'||img.kind==='new-video'){
        body+='\n\n{{< video src="'+img.url+'" >}}';
        continue;
      }
      // 如果图片URL已包含完整路径（如原有的动态图片），直接使用
      if(img.url&&!img.url.startsWith('/api/raw/')&&!img.url.startsWith('http')&&!img.url.startsWith('/')){
        // 相对路径，转换为完整路径
        body+='\n\n!['+(img.name.replace(/\.[^.]+$/,''))+']('+img.url+')';
        continue;
      }
      const localName=img.kind==='lib'?'img-'+Date.now().toString(36)+i+'-'+img.name:img.name;
      if(img.kind==='lib'){
        I('mom-status').textContent='复制图片: '+img.name;
        const f=await gh('/contents/static/posts/images/'+encodeURIComponent(img.name));
        const targetPath=PP+'/'+slug+'/'+localName;
        await gh('/contents/'+ghp(targetPath),{method:'PUT',body:JSON.stringify({message:'admin: copy '+img.name,content:f.content,branch:B})});
      }
      body+='\n\n!['+(localName.replace(/\.[^.]+$/,''))+']('+localName+')';
    }

    // 构建 front matter
    momTitle=(I('mom-title')?.value||'').trim();
    const title=momTitle||'';
    const fm=[
      'title: "'+title.replace(/"/g,'\\"')+'"',
      'date: '+nowISO(),
      'draft: false',
      'type: moment'
    ];
    if(momTags.length){
      fm.push('tags: ['+momTags.map(t=>'"'+t.replace(/"/g,'\\"')+'"').join(',')+']');
    }
    if(momLocation)fm.push('location: "'+momLocation.replace(/"/g,'\\"')+'"');

    const content=b64e('---\n'+fm.join('\n')+'\n---\n\n'+body);
    
    // 编辑模式：更新文件（需要 sha）
    const pb={message:editingSlug?'admin: update moment '+slug:'admin: publish moment '+slug,content,branch:B};
    if(editingSlug&&editingSha)pb.sha=editingSha;
    await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify(pb)});

    T(editingSlug?'修改已保存':'发表成功','ok');
    I('mom-status').textContent=editingSlug?'✓ 修改已保存':'✓ 发表成功';
    setTimeout(()=>location.href='index.html',600);
  }catch(e){
    T('操作失败: '+e.message,'err');
    I('mom-status').textContent='✗ '+e.message;
    btn.disabled=false;
    btn.textContent=editingSlug?'保存修改':'发表';
  }
}