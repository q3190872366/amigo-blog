// moments.js - 发布动态页面逻辑
let momImgs=[];       // [{name,url,path,kind:'new'|'lib'}]
let momSlug='';       // 当前动态的目录名（图片上传用）
let momLibImgs=[];    // 媒体库缓存
let momTopic='';      // 选中话题

// 鉴权检查（未登录跳回首页）
if(!requireAuth()){
  // 不再继续执行
}else{
  momSlug=nowSlug();
  loadTopics();
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

// 加载话题（从已有动态的 tags/categories 收集）
async function loadTopics(){
  try{
    const data=await gh('/contents/'+PP);
    const topics=new Set();
    for(const it of data){
      if(it.type!=='dir')continue;
      try{
        const f=await gh('/contents/'+ghp(PP+'/'+it.name+'/index.md'));
        const fm=parseFM(b64d(f.content));
        if(fm.type==='moment'||!fm.type){
          if(Array.isArray(fm.tags))fm.tags.forEach(t=>topics.add(t));
          if(Array.isArray(fm.categories))fm.categories.forEach(c=>topics.add(c));
        }
      }catch(_){}
    }
    const sel=I('mom-topic');
    sel.innerHTML='<option value="">选择话题（可选）</option>'+
      Array.from(topics).slice(0,30).map(t=>'<option value="'+esc(t)+'">'+esc(t)+'</option>').join('');
    sel.onchange=()=>{momTopic=sel.value};
  }catch(_){}
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
    const status=I('mom-status');
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
  const status=I('mom-status');
  for(const file of files){
    try{
      status.textContent='上传中: '+file.name;
      const{blob,ext}=await compImg(file,1600,0.82,true);
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
  const status=I('mom-status');
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
  const status=I('mom-status');
  // 按 basename 分组
  const groups = new Map(); // key=basename
  for(const f of files){
    const ext = f.name.split('.').pop().toLowerCase();
    const base = f.name.replace(/\.[^.]+$/, '');
    const isVideo = /^(mp4|mov|webm|m4v)$/i.test(ext);
    const isImage = /^(jpe?g|png|webp|heic|heif)$/i.test(ext);
    if(!isVideo && !isImage){status.textContent='跳过不支持的文件: '+f.name;continue}
    if(!groups.has(base))groups.set(base,{img:null,vid:null});
    const g = groups.get(base);
    if(isVideo)g.vid=f; else g.img=f;
  }
  for(const [base, g] of groups){
    try{
      status.textContent='实况图: '+base;
      if(!g.img){status.textContent='缺图片: '+base;continue}
      let imgUrl, vidUrl;
      // 上传图片
      try{
        const mode=getStorageMode();
        if(mode==='r2'){
          const r2r=await r2Upload(g.img);
          imgUrl=r2r.url;
          if(g.vid){
            const r2v=await r2Upload(g.vid);
            vidUrl=r2v.url;
          }
        }else{
          throw new Error('github-mode');
        }
      }catch(_){
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
      momImgs.push({
        name:base,
        kind:'livephoto',
        imgName: g.img.name,
        vidName: g.vid ? g.vid.name : null,
        imgUrl, vidUrl
      });
      renderMomImgs();
      status.textContent='实况图已上传: '+(g.vid?base+'(图+视频)':base+'(仅图)');
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
async function openMomLib(){
  I('mom-lib').classList.add('on');
  I('mom-lib-q').value='';
  if(!momLibImgs.length)await refreshMomLib();
  else filterMomLib();
}

function closeMomLib(){I('mom-lib').classList.remove('on')}

async function refreshMomLib(){
  const grid=I('mom-lib-grid');
  grid.innerHTML='<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--m)">加载中...</div>';
  momLibImgs=[];
  try{
    // 扫描公共图片目录
    const files=await gh('/contents/static/posts/images');
    momLibImgs=files.filter(f=>/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name)).map(f=>({name:f.name,url:LOCAL?'/api/raw/static/posts/images/'+encodeURIComponent(f.name):CDN+'/static/posts/images/'+f.name,path:'static/posts/images/'+f.name}));
    filterMomLib();
  }catch(e){
    grid.innerHTML='<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--m)">加载失败: '+e.message+'</div>';
  }
}

function filterMomLib(){
  const q=(I('mom-lib-q').value||'').toLowerCase();
  const fl=momLibImgs.filter(x=>x.name.toLowerCase().includes(q));
  const grid=I('mom-lib-grid');
  grid.innerHTML=fl.length?fl.map(x=>'<div class="lib-item" onclick="pickLibImg(\''+x.name+'\')"><img src="'+x.url+'" alt="'+esc(x.name)+'" loading="lazy"><div class="nm">'+esc(x.name)+'</div></div>').join(''):'<div style="grid-column:1/-1;padding:20px;text-align:center;color:var(--m)">没有图片</div>';
}

function pickLibImg(name){
  const url=LOCAL?'/api/raw/static/posts/images/'+encodeURIComponent(name):CDN+'/static/posts/images/'+name;
  momImgs.push({name,url,path:'static/posts/images/'+name,kind:'lib'});
  renderMomImgs();
  closeMomLib();
  T('已添加: '+name,'ok');
  onText();
}

// 发表
async function publishMoment(){
  const text=I('mom-text').value.trim();
  if(!text&&!momImgs.length){T('请输入内容','err');return}
  const btn=I('mom-publish');
  btn.disabled=true;
  btn.textContent='发表中...';
  I('mom-status').textContent='正在发表...';
  try{
    // 如果有图片但是从媒体库导入的（没上传到当前动态目录），需要 copy 到当前目录
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
        // 实况图：用主题的 livephoto shortcode
        if(img.vidUrl){
          body+='\n\n{{< livephoto image="'+esc(img.imgUrl)+'" video="'+esc(img.vidUrl)+'" >}}';
        }else{
          body+='\n\n!['+esc(img.name)+']('+esc(img.imgUrl)+')';
        }
        continue;
      }
      if(img.kind==='r2-video'||img.kind==='new-video'){
        // 短视频：用 video shortcode
        body+='\n\n{{< video src="'+esc(img.url)+'" >}}';
        continue;
      }
      const localName=img.kind==='lib'?'img-'+Date.now().toString(36)+i+'-'+img.name:img.name;
      if(img.kind==='lib'){
        // 从媒体库复制到当前目录
        I('mom-status').textContent='复制图片: '+img.name;
        const f=await gh('/contents/static/posts/images/'+encodeURIComponent(img.name));
        const targetPath=PP+'/'+slug+'/'+localName;
        await gh('/contents/'+ghp(targetPath),{method:'PUT',body:JSON.stringify({message:'admin: copy '+img.name,content:f.content,branch:B})});
      }
      body+='\n\n!['+(localName.replace(/\.[^.]+$/,''))+']('+localName+')';
    }

    // 构建 front matter
    const topic=momTopic;
    const fm=[
      'title: ""',
      'date: '+nowISO(),
      'draft: false',
      'type: moment'
    ];
    if(topic)fm.push('tags: ["'+topic.replace(/"/g,'\\"')+'"]');

    const content=b64e('---\n'+fm.join('\n')+'\n---\n\n'+body);
    await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify({message:'admin: publish moment '+slug,content,branch:B})});

    T('发表成功','ok');
    I('mom-status').textContent='✓ 发表成功';
    setTimeout(()=>location.href='index.html',600);
  }catch(e){
    T('发表失败: '+e.message,'err');
    I('mom-status').textContent='✗ '+e.message;
    btn.disabled=false;
    btn.textContent='发表';
  }
}