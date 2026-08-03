// ======== State ========
let P='',O='',R='',B='master',PP='content/posts';
let posts=[],imgs=[],curP=null,cv='dashboard';
const CDN='https://cdn.jsdelivr.net/gh/q3190872366/amigo-blog@master';
const LOCAL=(location.port==='8787')||new URLSearchParams(location.search).get('local')==='1';
const I=(id)=>document.getElementById(id);
const T=(m,t)=>{const e=I('toast');e.textContent=m;e.className=t;clearTimeout(e._t);e._t=setTimeout(()=>e.className='',2500)};

// ======== Init ========
function init(){
  const s=localStorage.getItem('blog_adm3');
  if(s){try{const d=JSON.parse(s);P=d.pat||'';O=d.owner||'q3190872366';R=d.repo||'amigo-blog';B=d.branch||'master';PP=d.path||'content/posts';if(P)I('li-token').value=P;I('li-owner').value=O;I('li-repo').value=R}catch(_){}}
}
init();

function doLogin(){
  P=I('li-token').value.trim();O=I('li-owner').value.trim();R=I('li-repo').value.trim();
  if(!LOCAL&&(!P||!O||!R)){T('请填写完整','err');return}
  if(LOCAL){O=O||'local';R=R||'local'}
  localStorage.setItem('blog_adm3',JSON.stringify({pat:P,owner:O,repo:R,branch:B,path:PP}));
  I('login').style.display='none';I('app').classList.add('open');
  loadDash();
}
function doLogout(){localStorage.removeItem('blog_adm3');location.reload()}

// ======== GitHub API ========
function gh(p,o={}){
  if(LOCAL)return localApi(p,o);
  return fetch('https://api.github.com/repos/'+O+'/'+R+p,{...o,headers:{Authorization:'token '+P,Accept:'application/vnd.github+json','Content-Type':'application/json',...(o.headers||{})}}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'HTTP '+r.status);return d})
}
// 本地模式：把 GitHub Contents API 请求路由到本地服务 /api/contents
async function localApi(p,o={}){
  const rest=p.replace(/^\/contents/,'');
  const url='/api/contents'+rest;
  const opt={method:o.method||'GET',headers:{}};
  if(o.body)opt.body=o.body;
  const r=await fetch(url,opt);
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw new Error(d.message||('HTTP '+r.status));
  return d;
}
function ghp(p){return p.split('/').map(encodeURIComponent).join('/')}
function b64d(r){try{const b=Uint8Array.from(atob(r.replace(/\n/g,'')),c=>c.charCodeAt(0));return new TextDecoder('utf-8').decode(b)}catch(_){return atob(r.replace(/\n/g,''))}}
function b64e(s){const b=new TextEncoder().encode(s);let r='';for(const x of b)r+=String.fromCharCode(x);return btoa(r)}
function esc(s){return(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

// ======== FM parser ========
function parseFM(raw){const m=raw.match(/^---\n([\s\S]*?)\n---/);if(!m)return{};const fm={};let ck=null;m[1].split('\n').forEach(l=>{const a=l.match(/^\s+-\s+(.*)/);if(a&&ck){fm[ck]=fm[ck]||[];fm[ck].push(a[1].trim().replace(/^['"]|['"]$/g,''));return}const kv=l.match(/^(\w+):\s*(.*)/);if(kv){const v=kv[2].trim();fm[kv[1]]=v==='true'?true:v==='false'?false:v.replace(/^['"]|['"]$/g,'');ck=v===''||v==='[]'?kv[1]:null}});return fm}

// ======== Nav ========
function go(v){
  document.querySelectorAll('.view').forEach(x=>x.classList.remove('on'));
  document.querySelectorAll('[id^="v-"]').forEach(x=>{if(x!==I('v-'+v))x.classList.remove('on')});
  I('ed').classList.remove('on');
  if(['posts','moments'].includes(v))I('v-posts').classList.add('on');
  else if(v==='editor')I('ed').classList.add('on');
  else I('v-'+v)?.classList.add('on');
  document.querySelectorAll('.nav-item').forEach(x=>x.classList.remove('on'));
  document.querySelector('.nav-item[data-v="'+v+'"]')?.classList.add('on');
  cv=v;
  I('bc').innerHTML={'dashboard':'仪表盘','posts':'仪表盘 / 文章管理','moments':'仪表盘 / 动态管理','media':'仪表盘 / 媒体库','editor':'仪表盘 / 编辑文章','profile':'仪表盘 / 个人资料','friends':'仪表盘 / 友链管理','music':'仪表盘 / 音乐管理','storage':'仪表盘 / 云端存储','site':'仪表盘 / 网站设置','ads':'仪表盘 / 内容管理 / 广告','comments':'仪表盘 / 内容管理 / 评论','douban':'仪表盘 / 内容管理 / 豆瓣影单','blacklist':'仪表盘 / 内容管理 / 黑名单','subscribe':'仪表盘 / 订阅友圈'}[v].split(' / ').map(s=>'<span>'+s+'</span>').join('');
  if(v==='posts'||v==='moments')loadPosts();
  if(v==='media')loadImgs();
  if(v==='dashboard')loadDash();
  if(v==='friends')loadFriends();
  if(v==='profile')loadProfile();
  if(v==='site')loadSite();
  if(v==='music')loadMusic();
  if(window.innerWidth<768)I('sidebar').classList.remove('open');
}

// ======== Dashboard ========
async function loadDash(){
  try{
    const data=await gh('/contents/'+PP);let mp=0,md=0,rc=0,im=0;
    const w=new Date(Date.now()-7*86400000);
    for(const it of data){if(it.type!=='dir')continue;md++;try{
      const f=await gh('/contents/'+ghp(PP+'/'+it.name+'/index.md'));
      const fm=parseFM(b64d(f.content));
      if(fm.draft)mp++;
      if(f.commit?.author?.date&&new Date(f.commit.author.date)>w)rc++;
      try{const ims=await gh('/contents/'+PP+'/'+it.name);ims.forEach(x=>{if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(x.name))im++})}catch(_){}
    }catch(_){}}
    I('s-m').textContent=md;I('s-p').textContent=mp;I('s-c').textContent=0;I('s-l').textContent=Math.floor(im*1.5);
    drawCharts(rc,mp,md);
    renderRecent(rc);
  }catch(e){T('加载失败: '+e.message,'err')}
}
let _bar,_donut;
async function drawCharts(recent,posts,moments){await needC();if(typeof Chart==='undefined')return;
  const labels=['7/27','7/28','7/29','7/30','7/31','8/1','8/2'];
  const data=[0,0,0,0,0,0,recent];
  if(_bar)_bar.destroy();
  _bar=new Chart(I('c-bar'),{type:'bar',data:{labels,datasets:[{label:'动态',data:data.map(d=>Math.max(0,d)),backgroundColor:'#3b82f6'},{label:'文章',data:data.map(()=>0),backgroundColor:'#10b981'},{label:'评论',data:data.map(()=>0),backgroundColor:'#f59e0b'},{label:'点赞',data:data.map(()=>Math.floor(recent/2)),backgroundColor:'#8b5cf6'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom'}},scales:{y:{beginAtZero:true}}}});
  if(_donut)_donut.destroy();
  _donut=new Chart(I('c-donut'),{type:'doughnut',data:{labels:['动态 '+moments,'文章 '+posts,'评论 0','点赞 '+Math.floor((moments+posts)*1.5)],datasets:[{data:[moments,posts,0,Math.floor((moments+posts)*1.5)],backgroundColor:['#3b82f6','#10b981','#f59e0b','#8b5cf6']}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'right'}}}});
}
function renderRecent(n){
  I('r-m').innerHTML=n?posts.slice(0,5).map(p=>'<div class="recent-row"><span>'+esc(p.title)+'</span><span class="ti">'+esc((p.date||'').slice(0,10))+'</span></div>').join(''):'<div class="empty">暂无</div>';
  I('r-c').innerHTML='<div class="empty">暂无评论</div>';
}

// ======== Posts ========
async function loadPosts(){
  try{const data=await gh('/contents/'+PP);posts=[];
    for(const it of data){if(it.type!=='dir')continue;try{
      const f=await gh('/contents/'+ghp(PP+'/'+it.name+'/index.md'));
      const raw=b64d(f.content),fm=parseFM(raw);
      const c=fm.categories||[],t=fm.tags||[];posts.push({slug:it.name,title:fm.title||it.name,date:fm.date||'',sha:f.sha,draft:fm.draft,cats:Array.isArray(c)?c:[c].filter(Boolean),tags:Array.isArray(t)?t:[t].filter(Boolean),raw});
    }catch(_){posts.push({slug:it.name,title:it.name,date:'',sha:null,draft:false,cats:[],tags:[],raw:''})}}
    posts.sort((a,b)=>(b.date||'').localeCompare(a.date||''));renderPosts();
  }catch(e){I('p-list').innerHTML='<div class="empty">加载失败: '+e.message+'</div>'}
}
function renderPosts(){
  const q=(I('p-search').value||'').toLowerCase(),f=I('p-filter').value;
  const fl=posts.filter(p=>{if(q&&!p.title.toLowerCase().includes(q)&&!p.slug.toLowerCase().includes(q))return 0;if(f==='draft'&&!p.draft)return 0;if(f==='pub'&&p.draft)return 0;return 1});
  I('p-list').innerHTML=fl.length?fl.map(p=>'<div class="pitem" onclick="editP(\''+p.slug+'\')"><div><div class="title">'+esc(p.title)+'</div><div class="meta">'+(p.date?p.date.slice(0,10):'')+(p.cats.length?' · '+p.cats.join(', '):'')+(p.tags.length?' · '+p.tags.join(', '):'')+'</div></div><span class="badge '+(p.draft?'draft':'pub')+'">'+(p.draft?'草稿':'已发布')+'</span></div>').join(''):'<div class="empty">没有文章</div>';
}
function fmDefault(){const n=new Date();return {title:'新文章',slug:'',date:n.toISOString().slice(0,10),draft:true,author:'',summary:'',cover:'',comments:true,categories:[],tags:[]}}
function fillFmForm(fm){I('em-t').value=fm.title||'';I('em-slug').value=fm.slug||'';I('em-date').value=(fm.date||'').slice(0,10);I('em-author').value=fm.author||'';I('em-cats').value=Array.isArray(fm.categories)?fm.categories.join(','):(fm.categories||'');I('em-tags').value=Array.isArray(fm.tags)?fm.tags.join(','):(fm.tags||'');I('em-summary').value=fm.summary||'';I('em-sub').textContent=fm.title||'新文章';updateFolder()}
function updateFolder(){const slug=(I('em-slug').value||'').trim()||(I('em-t').value||'新文章').replace(/[^\w一-龥]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase();const d=(I('em-date').value||new Date().toISOString().slice(0,10));I('em-folder').textContent=d+'-'+slug}
function syncFm(){updateFolder();const fm=[];const t=I('em-t').value.trim();if(t)fm.push('title: "'+t.replace(/"/g,'\\"')+'"');const s=I('em-slug').value.trim();if(s)fm.push('slug: "'+s+'"');const d=I('em-date').value;if(d)fm.push('date: '+d+'T00:00:00+08:00');const a=I('em-author').value.trim();if(a)fm.push('author: "'+a+'"');const sm=I('em-summary').value.trim();if(sm)fm.push('summary: "'+sm.replace(/"/g,'\\"')+'"');const c=I('em-cats').value.split(',').map(x=>x.trim()).filter(Boolean);if(c.length)fm.push('categories: ['+c.map(x=>'"'+x+'"').join(', ')+']');const tg=I('em-tags').value.split(',').map(x=>x.trim()).filter(Boolean);if(tg.length)fm.push('tags: ['+tg.map(x=>'"'+x+'"').join(', ')+']');fm.push('draft: true');fm.push('comments: true');I('em-fm').value=fm.join('\n');I('em-sub').textContent=t||'新文章'}
function newPost(){curP=null;I('editor').value='';fillFmForm(fmDefault());syncFm();I('preview').innerHTML='';go('editor');swPane('edit');upPrev();upCnt()}
function editP(slug){const p=posts.find(x=>x.slug===slug);if(!p)return;curP=p;const m=p.raw.match(/^---\n([\s\S]*?)\n---/);I('editor').value=m?p.raw.replace(/^---\n[\s\S]*?\n---\n/,''):p.raw;const fm=m?parseFM(p.raw):{};fillFmForm(fm);syncFm();go('editor');swPane('edit');upPrev();upCnt()}
async function upPrev(){await needM();let html=marked.parse(I('editor').value||'');if(LOCAL){html=html.replace(/<img([^>]*)src="([^"]+)"([^>]*)>/g,(w,a,src,c)=>{if(/^(https?:)?\/\//.test(src)||src.startsWith('/'))return w;const fb=curP?'/static/posts/images/'+src:'';const base=curP?'/api/raw/content/posts/'+curP.slug+'/'+src:'/static/posts/images/'+src;return fb?'<img'+a+'src="'+base+'" data-fb="'+fb+'" onerror="if(this.dataset.fb&&!this.dataset.t){this.dataset.t=1;this.src=this.dataset.fb}"'+c+'>':'<img'+a+'src="'+base+'"'+c+'>'});}I('preview').innerHTML=html;if(typeof upCnt==='function')upCnt()}
function bFM(){const fm=I('em-fm').value.trim();if(!fm)return'---\n---\n\n';return '---\n'+fm+'\n---\n'}
async function save(pub){syncFm();const body=I('editor').value,t=I('em-t').value.trim()||'未命名',isNew=!curP;if(pub){I('em-fm').value=I('em-fm').value.replace(/draft:\s*\w+/,'draft: false')}const all=bFM()+body;try{let slug,path,sha=null;const userSlug=(I('em-slug').value||'').trim();if(isNew){const d=(I('em-date').value||new Date().toISOString().slice(0,10));const s=userSlug||(t.replace(/[^\w一-龥]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase().slice(0,40)||'post');slug=d+'-'+s;path=PP+'/'+slug+'/index.md'}else{slug=curP.slug;path=PP+'/'+slug+'/index.md';sha=curP.sha}const pb={message:'admin: '+(pub?'publish':'update')+' '+t,content:b64e(all),branch:B};if(sha)pb.sha=sha;await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify(pb)});T(pub?'已发布':'已保存','ok');await loadPosts();const i=posts.findIndex(p=>p.slug===slug);if(i>=0)curP=posts[i];if(pub)setTimeout(()=>doDeploy(),500)}catch(e){T('保存失败: '+e.message,'err')}}
async function del(){if(!curP)return;if(!confirm('确定删除「'+curP.title+'」？'))return;try{const dir=await gh('/contents/'+PP+'/'+curP.slug);for(const f of dir)if(f.sha)await gh('/contents/'+ghp(f.path),{method:'DELETE',body:JSON.stringify({message:'admin: delete '+f.name,sha:f.sha,branch:B})});T('已删除','ok');loadPosts();go('posts')}catch(e){T('删除失败: '+e.message,'err')}}

// ======== Editor fmt ========
function doFmt(t){const e=I('editor'),s=e.selectionStart,ed=e.selectionEnd,sel=e.value.substring(s,ed);let b=e.value.substring(0,s),a=e.value.substring(ed),ls=b.lastIndexOf('\n')+1;switch(t){case'undo':document.execCommand('undo');return;case'redo':document.execCommand('redo');return;case'bold':b+='**';a='**'+a;break;case'italic':b+='*';a='*'+a;break;case'strike':b+='~~';a='~~'+a;break;case'code':b+='`';a='`'+a;break;case'h2':b=b.substring(0,ls)+'## '+b.substring(ls);break;case'h3':b=b.substring(0,ls)+'### '+b.substring(ls);break;case'h4':b=b.substring(0,ls)+'#### '+b.substring(ls);break;case'ul':b=b.substring(0,ls)+'- '+b.substring(ls);break;case'ol':b=b.substring(0,ls)+'1. '+b.substring(ls);break;case'task':b=b.substring(0,ls)+'- [ ] '+b.substring(ls);break;case'quote':b=b.substring(0,ls)+'> '+b.substring(ls);break;case'link':{const u=prompt('链接 URL:');if(u){b+='['+(sel||'链接文字')+']('+u+')';a=')'+a}}break;case'pre':const lang=prompt('语言（可选）:','');b+='```'+(lang||'')+'\n';a='\n```'+a;break;case'hr':b+='\n---\n';break;case'table':{const r=parseInt(prompt('行数:','3'))||3,c=parseInt(prompt('列数:','3'))||3;let tbl='\n|';for(let i=0;i<c;i++)tbl+=' 表头'+(i+1)+' |';tbl+='\n|';for(let i=0;i<c;i++)tbl+=' --- |';tbl+='\n';for(let i=0;i<r;i++){tbl+='|';for(let j=0;j<c;j++)tbl+=' 内容 |';tbl+='\n'}b+=tbl}break}e.value=b+(sel||'')+a;e.focus();upPrev();upCnt()}
function upCnt(){const t=I('editor').value,c=t.replace(/\s+/g,'').length,w=Math.max(1,Math.ceil(c/400));I('st-cnt').textContent=c+' 字';I('st-time').textContent='≈'+w+' 分钟'}

// ======== Editor mode / pane ========
function setMode(m){const body=I('ed-body');if(m==='split'){body.style.gridTemplateColumns='1fr 1fr';body.style.display='grid'}else if(m==='edit'||m==='preview'){body.style.gridTemplateColumns='1fr';body.style.display='grid'}if(window.innerWidth<900){if(m==='split')swPane('edit');else swPane(m)}}
function swPane(p){document.querySelectorAll('.ed-tab').forEach(x=>x.classList.toggle('on',x.dataset.pane===p));document.querySelectorAll('.ed-pane').forEach(x=>x.classList.toggle('on',x.classList.contains('ed-'+p)));if(p==='preview')upPrev()}

// ======== Front matter modal ========
function openFm(){I('ed-fm').classList.add('on');I('em-fm').focus()}
function closeFm(){I('ed-fm').classList.remove('on')}
function getFm(){let raw=I('em-fm').value.trim();if(!raw)return null;try{return{text:raw,parsed:parseFM('---\n'+raw+'\n---\n')}}catch(_){return null}}

// ======== Image ========
function compImg(file,mw,q,webp){return new Promise((ok,no)=>{const img=new Image();img.onload=()=>{const w=Math.min(img.width,mw),h=img.height*w/img.width;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);c.toBlob(b=>{const m=webp?'image/webp':file.type;const ext=m==='image/webp'?'.webp':m==='image/png'?'.png':'.jpg';ok({blob:b,ext})},webp?'image/webp':file.type,q/100)};img.onerror=no;img.src=URL.createObjectURL(file)})}
function upOne(f){if(!f||!f.length)return;const w=I('em-w')?.checked;upMany(f,w)}

// ======== Image manager modal ========
let mgrImgs=[];
function openImgMgr(){I('img-modal').classList.add('on');swImgTab('upload');refreshMgr()}
function closeImgMgr(){I('img-modal').classList.remove('on')}
function swImgTab(t){document.querySelectorAll('.img-tab').forEach(x=>x.classList.toggle('on',x.dataset.tab===t));document.querySelectorAll('.img-tab-pane').forEach(x=>x.classList.toggle('on',x.dataset.pane===t));if(t==='library')refreshMgr()}
async function refreshMgr(){
  const grid=I('img-mgr-grid');
  const empty=I('img-mgr-empty');
  grid.innerHTML='';empty.style.display='none';
  grid.innerHTML='<div class="empty" style="grid-column:1/-1">加载中...</div>';
  mgrImgs=[];
  try{
    const ps=await gh('/contents/'+PP);
    for(const p of ps){
      if(p.type!=='dir')continue;
      try{
        const files=await gh('/contents/'+ghp(PP+'/'+p.name));
        for(const f of files){
          if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name)){
            mgrImgs.push({name:f.name,path:f.path,sha:f.sha,url:f.download_url,slug:p.name});
          }
        }
      }catch(_){}
    }
    try{
      const files=await gh('/contents/static/posts/images');
      for(const f of files){
        if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name)){
          mgrImgs.push({name:f.name,path:f.path,sha:f.sha,url:f.download_url,slug:'公共'});
        }
      }
    }catch(_){}
    filterMgr();
  }catch(e){grid.innerHTML='';empty.style.display='block';empty.textContent='加载失败: '+e.message}
}
function filterMgr(){
  const grid=I('img-mgr-grid');
  const empty=I('img-mgr-empty');
  const q=(I('img-mgr-search').value||'').toLowerCase();
  const fl=mgrImgs.filter(x=>x.name.toLowerCase().includes(q)||x.slug.toLowerCase().includes(q));
  if(!fl.length){grid.innerHTML='';empty.style.display='block';empty.textContent='没有图片';return}
  empty.style.display='none';
  grid.innerHTML=fl.map(x=>'<div class="img-card" onclick="insImgToEd(\''+x.name+'\',\''+x.slug+'\')" title="'+esc(x.name)+'"><img src="'+x.url+'" alt="'+esc(x.name)+'" loading="lazy"><div class="img-info">'+esc(x.name.slice(0,16))+(x.name.length>16?'...':'')+'</div></div>').join('');
}
function imgCdnUrl(name,slug){
  if(slug==='公共'||!slug)return CDN+'/static/posts/images/'+name;
  return CDN+'/content/posts/'+slug+'/'+name;
}
// 本地模式返回本地可访问路径（公共图走 /static，文章图走相对名由预览改写）
function imgRef(name,slug){
  if(LOCAL){
    if(slug==='公共'||!slug)return '/static/posts/images/'+name;
    return name;
  }
  return imgCdnUrl(name,slug);
}
function insImgToEd(name,slug){
  const ref=imgRef(name,(slug==='公共'||!curP)?'公共':curP.slug);
  insAt('!['+name.replace(/\.[^.]+$/,'')+']('+ref+')');
  upPrev();upCnt();
  closeImgMgr();
  T('已插入: '+name,'ok');
}
async function mgrUpload(files){
  if(!files||!files.length)return;
  const status=I('img-mgr-status');
  const mw=parseInt(I('mgr-mw').value)||1600;
  const qv=parseInt(I('mgr-q').value)||82;
  const webp=I('mgr-w').checked;
  for(const file of files){try{
    status.textContent='处理中: '+file.name;
    const{blob,ext}=await compImg(file,mw,qv/100,webp);
    const bn='img-'+Date.now().toString(36)+ext;
    const r=new FileReader();
    const content=await new Promise((ok,no)=>{r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(blob)});
    let dir;
    if(curP)dir=PP+'/'+curP.slug;
    else dir='static/posts/images';
    await gh('/contents/'+ghp(dir+'/'+bn),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bn,content,branch:B})});
    status.textContent='已上传: '+bn;
    insImgToEd(bn,curP?curP.slug:'公共');
  }catch(e){status.textContent='失败: '+e.message}}
  refreshMgr();
}
async function upMany(files,fw){
  if(!files||!files.length)return;
  const webp=fw!==undefined?fw:(I('i-w')?.checked??true);
  const mw=parseInt(I('i-mw')?.value)||1600,q=parseInt(I('i-q')?.value)||82;
  let dir;
  if(!curP&&cv==='media')dir='static/posts/images';
  else if(!curP){T('请先保存草稿再上传','err');return}
  else dir=PP+'/'+curP.slug;
  for(const file of files){try{
    T('处理 '+file.name+'...','info');
    const{blob,ext}=await compImg(file,mw,q,webp);
    const bn='img-'+Date.now().toString(36)+ext;
    const r=new FileReader();
    const content=await new Promise((ok,no)=>{r.onload=()=>ok(r.result.split(',')[1]);r.onerror=no;r.readAsDataURL(blob)});
    const path=dir+'/'+bn;
    await gh('/contents/'+ghp(path),{method:'PUT',body:JSON.stringify({message:'admin: upload '+bn,content,branch:B})});
    if(curP){insAt('!['+bn+']('+imgRef(bn,curP.slug)+')');upPrev()}
    T('已上传 '+bn,'ok');
  }catch(e){T('上传失败: '+e.message,'err')}}
  if(cv==='media')loadImgs();
}
function insAt(t){const e=I('editor'),s=e.selectionStart,ed=e.selectionEnd;e.value=e.value.substring(0,s)+t+e.value.substring(ed);e.selectionStart=e.selectionEnd=s+t.length}

// ======== Media ========
async function loadImgs(){I('i-grid').innerHTML='<div class="empty">扫描中...</div>';imgs=[];
  try{const ps=await gh('/contents/'+PP);
    for(const p of ps){if(p.type!=='dir')continue;try{const fs=await gh('/contents/'+PP+'/'+p.name);for(const f of fs)if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name))imgs.push({name:f.name,path:f.path,sha:f.sha,url:f.download_url,slug:p.name})}catch(_){}}
    try{const fs=await gh('/contents/static/posts/images');for(const f of fs)if(/\.(jpg|jpeg|png|gif|webp|svg)$/i.test(f.name))imgs.push({name:f.name,path:f.path,sha:f.sha,url:f.download_url,slug:'公共'})}catch(_){}
    renderImgs();
  }catch(e){I('i-grid').innerHTML='<div class="empty">加载失败: '+e.message+'</div>'}
}
function renderImgs(){I('i-grid').innerHTML=imgs.length?imgs.map(x=>{const u=imgRef(x.name,x.slug);return '<div class="img-card"><img src="'+x.url+'" alt="'+esc(x.name)+'" loading="lazy"><div class="img-acts"><button onclick="cpy(\''+u+'\')">复制</button><button onclick="delI(\''+x.path+'\',\''+x.sha+'\')">删除</button></div><div class="img-info"><span>'+esc(x.name)+'</span><span>'+esc(x.slug)+'</span></div></div>'}).join(''):'<div class="empty">还没有图片</div>'}
function cpy(u){navigator.clipboard.writeText(u);T('已复制','ok')}
async function delI(p,sha){if(!confirm('删除？'))return;try{await gh('/contents/'+ghp(p),{method:'DELETE',body:JSON.stringify({message:'admin: delete image',sha,branch:B})});T('已删除','ok');loadImgs()}catch(e){T('删除失败: '+e.message,'err')}}

// ======== Settings: profile/site/music ========
async function loadToml(){try{const f=await gh('/contents/hugo.toml');return b64d(f.content)}catch(e){return''}}
async function saveToml(content,msg){const f=await gh('/contents/hugo.toml');const pb={message:'admin: '+msg,content:b64e(content),branch:B,sha:f.sha};await gh('/contents/hugo.toml',{method:'PUT',body:JSON.stringify(pb)})}
function getVal(toml,key){const m=toml.match(new RegExp(key+'\\s*=\\s*"?([^"\\n]*)"?'));return m?m[1].trim():''}
function setVal(toml,key,val){const re=new RegExp('('+key+'\\s*=\\s*"?)[^"\\n]*("?)');if(toml.match(re))return toml.replace(re,'$1'+val+'$2');return toml+'\n'+key+' = "'+val+'"'}
async function loadProfile(){const t=await loadToml();I('pr-user').value=getVal(t,'username');I('pr-desc').value=getVal(t,'description');I('pr-avatar').value=getVal(t,'avatar');I('pr-cover').value=getVal(t,'headerMedia')}
async function saveProfile(){try{let t=await loadToml();t=setVal(t,'username',I('pr-user').value);t=setVal(t,'description',I('pr-desc').value);t=setVal(t,'avatar',I('pr-avatar').value);t=setVal(t,'headerMedia',I('pr-cover').value);await saveToml(t,'update profile');T(LOCAL?'已保存（本地）':'已保存，正在部署...','ok');setTimeout(()=>doDeploy(),500)}catch(e){T('保存失败: '+e.message,'err')}}
async function loadSite(){const t=await loadToml();I('st-title').value=getVal(t,'title');I('st-lang').value=getVal(t,'languageCode');I('st-foot').value=getVal(t,'footerText');I('st-cm').value=getVal(t,'commentMode');I('st-pjax').value=getVal(t,'enablePjax')}
async function saveSite(){try{let t=await loadToml();t=setVal(t,'title',I('st-title').value);t=setVal(t,'languageCode',I('st-lang').value);t=setVal(t,'footerText',I('st-foot').value);t=setVal(t,'commentMode',I('st-cm').value);t=setVal(t,'enablePjax',I('st-pjax').value);await saveToml(t,'update site');T('已保存','ok')}catch(e){T('保存失败: '+e.message,'err')}}
async function loadMusic(){const t=await loadToml();I('mu-url').value=getVal(t,'musicPluginUrl');I('mu-pl').value=getVal(t,'musicPlaylist');I('mu-auto').value=getVal(t,'musicAutoplay')}
async function saveMusic(){try{let t=await loadToml();t=setVal(t,'musicPluginUrl',I('mu-url').value);t=setVal(t,'musicPlaylist',I('mu-pl').value);t=setVal(t,'musicAutoplay',I('mu-auto').value);await saveToml(t,'update music');T('已保存','ok')}catch(e){T('保存失败: '+e.message,'err')}}

// ======== Friends ========
async function loadFriends(){try{const f=await gh('/contents/'+PP.replace('content/posts','data')+'/friends.yml');I('fr-yaml').value=b64d(f.content)}catch(_){try{const f=await gh('/contents/data/friends.yml');I('fr-yaml').value=b64d(f.content)}catch(e){I('fr-yaml').value=''}}
async function saveFriends(){try{const path='data/friends.yml';let sha=null;try{const f=await gh('/contents/'+path);sha=f.sha}catch(_){}const pb={message:'admin: update friends',content:b64e(I('fr-yaml').value),branch:B};if(sha)pb.sha=sha;await gh('/contents/'+path,{method:'PUT',body:JSON.stringify(pb)});T('已保存','ok')}catch(e){T('保存失败: '+e.message,'err')}}

// ======== Deploy ========
async function doDeploy(){if(LOCAL){T('本地模式：已保存，Hugo 自动热更新','ok');return}try{await gh('/actions/workflows/deploy.yml/dispatches',{method:'POST',body:JSON.stringify({ref:B})});T('已触发部署','ok')}catch(e){T('触发失败: '+e.message,'err')}}

// ======== Drag & Drop ========
['dragover','dragenter'].forEach(ev=>document.body.addEventListener(ev,e=>{const z=e.target.closest('.up-zone');if(z){e.preventDefault();z.classList.add('drag')}}));
['dragleave','drop'].forEach(ev=>document.body.addEventListener(ev,e=>{const z=e.target.closest('.up-zone');if(z)z.classList.remove('drag')}));
document.body.addEventListener('drop',e=>{const z=e.target.closest('.up-zone');if(z&&e.dataTransfer.files.length){e.preventDefault();upMany(e.dataTransfer.files)}});

// ======== Keyboard ========
document.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();if(cv==='editor')save(false)}});

}