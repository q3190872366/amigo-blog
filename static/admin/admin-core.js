// admin-core.js - 后台共享模块（多页面架构基础）
// 新页面只需 <script src="admin-core.js"></script> + <script src="pages/xxx.js"></script>
// 提供：状态、认证、GitHub API、工具、Toast、CDN 懒加载、图片压缩
const I=(id)=>document.getElementById(id);
const T=(m,t)=>{const e=I('toast');if(!e)return;e.textContent=m;e.className=t;clearTimeout(e._t);e._t=setTimeout(()=>e.className='',2500)};

// ======== State ========
let P='',O='',R='',B='master',PP='content/posts';
const LOCAL=(location.port==='8787')||new URLSearchParams(location.search).get('local')==='1';
const CDN='https://cdn.jsdelivr.net/gh/q3190872366/amigo-blog@master';

// ======== Auth ========
function loadAuth(){
  try{
    const s=localStorage.getItem('blog_adm3');
    if(s){const d=JSON.parse(s);P=d.pat||'';O=d.owner||'q3190872366';R=d.repo||'amigo-blog';B=d.branch||'master';PP=d.path||'content/posts';return true}
  }catch(_){}
  return false;
}
function requireAuth(){
  if(!loadAuth()){location.href='index.html';return false}
  return true;
}
function doLogout(){localStorage.removeItem('blog_adm3');location.href='index.html'}

// ======== GitHub API ========
function gh(p,o={}){
  if(LOCAL)return localApi(p,o);
  return fetch('https://api.github.com/repos/'+O+'/'+R+p,{...o,headers:{Authorization:'token '+P,Accept:'application/vnd.github+json','Content-Type':'application/json',...(o.headers||{})}}).then(async r=>{const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.message||'HTTP '+r.status);return d})
}
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

// ======== Utilities ========
function b64d(r){try{const b=Uint8Array.from(atob(r.replace(/\n/g,'')),c=>c.charCodeAt(0));return new TextDecoder('utf-8').decode(b)}catch(_){return atob(r.replace(/\n/g,''))}}
function b64e(s){const b=new TextEncoder().encode(s);let r='';for(const x of b)r+=String.fromCharCode(x);return btoa(r)}
function esc(s){return(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function nowSlug(){const n=new Date();return n.toISOString().slice(0,10)+'-'+n.toISOString().slice(11,19).replace(/:/g,'')}
function nowISO(){return new Date().toISOString()}

// ======== Image compression ========
function compImg(file,mw,q,webp){return new Promise((ok,no)=>{const img=new Image();img.onload=()=>{const w=Math.min(img.width,mw),h=img.height*w/img.width;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);c.toBlob(b=>{const m=webp?'image/webp':file.type;const ext=m==='image/webp'?'.webp':m==='image/png'?'.png':'.jpg';ok({blob:b,ext})},webp?'image/webp':file.type,q/100)};img.onerror=no;img.src=URL.createObjectURL(file)})}

// ======== CDN lazy loader (needM/needC 由 head-init.js 提供) ========