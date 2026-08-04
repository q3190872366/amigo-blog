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
  // 不同 tab 用不同 input
  const addBtn=I('mom-img-add');
  if(t==='video'){addBtn.onclick=()=>I('mom-video-file').click();I('mom-img-file').value=''}
  else{addBtn.onclick=()=>I('mom-img-file').click();I('mom-video-file').value=''}
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

// 短视频占位
function momVideoUpload(files){
  if(!files||!files.length)return;
  I('mom-status').textContent='短视频上传：开发中（暂仅支持图片）';
}

// 渲染图片列表
function renderMomImgs(){
  const list=I('mom-img-list');
  // 重建 - 保留 add 按钮
  list.innerHTML='<div class="mom-img-add" id="mom-img-add" onclick="document.getElementById(\'mom-img-file\').click()">'+
    '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>';
  momImgs.forEach((img,i)=>{
    const d=document.createElement('div');
    d.className='mom-img-item';
    d.innerHTML='<img src="'+img.url+'" alt="'+esc(img.name)+'" loading="lazy"><button class="del" onclick="momDelImg('+i+')" aria-label="删除">✕</button>';
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
        // R2 图片直接用完整 URL
        body+='\n\n!['+(img.name.replace(/\.[^.]+$/,''))+']('+img.url+')';
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