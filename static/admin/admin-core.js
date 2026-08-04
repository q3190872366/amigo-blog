// admin-core.js - 后台共享模块（多页面架构基础）
// 新页面只需 <script src="admin-core.js"></script> + <script src="pages/xxx.js"></script>
// 提供：状态、认证、GitHub API、工具、Toast、CDN 懒加载、图片压缩
const I=(id)=>document.getElementById(id);
const T=(m,t)=>{const e=I('toast');if(!e)return;e.textContent=m;e.className=t;clearTimeout(e._t);e._t=setTimeout(()=>e.className='',2500)};

// ======== State ========
let P='',O='',R='',B='master',PP='content/posts';
const LOCAL=(location.port==='8787')||new URLSearchParams(location.search).get('local')==='1';
const CDN='https://cdn.jsdelivr.net/gh/q3190872366/amigo-blog@master';
// R2 上传后返回 7 天 presigned URL（用 R2_FUNCTION 通过 Pages Function 生成）

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

// ======== R2 存储模式 ========
function getStorageMode(){try{return JSON.parse(localStorage.getItem('blog_storage')||'{}').mode||'github'}catch(_){return'github'}}
function setStorageMode(m){localStorage.setItem('blog_storage',JSON.stringify({mode:m}));T('存储模式: '+(m==='r2'?'R2':'GitHub'),'ok')}
// R2 上传（返回 {name,url}），url 是 7 天 presigned URL（通过 /api/r2/url 生成）
async function r2Upload(file,prefix=''){
  const ext=file.name.split('.').pop().toLowerCase()||'webp';
  const mime=file.type||('image/'+ext);
  const bn=(prefix?prefix+'/':'')+'img-'+Date.now().toString(36)+Math.random().toString(36).slice(2,6)+'.'+ext;
  const rd=new FileReader();
  const content=await new Promise((ok,no)=>{rd.onload=()=>ok(rd.result.split(',')[1]);rd.onerror=no;rd.readAsDataURL(file)});
  const r=await fetch('/api/r2/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:bn,content,contentType:mime})});
  const d=await r.json();
  if(!r.ok)throw new Error(d.message||'R2 upload failed');
  // 使用干净的代理 URL（无 & 符号，不会被 Hugo 编码破坏）
  return {name:bn,url:'/api/r2/img?key='+encodeURIComponent(bn)};
}

// ======== Android Motion Photo 提取（客户端从 JPEG 分离 MP4） ========
// 参考 MotionFlow (github.com/DejavuMoe/MotionFlow)
async function extractMotionPhoto(file){
  return new Promise((resolve)=>{
    const rd=new FileReader();
    rd.onload=(e)=>{
      try{
        const buf=e.target.result,bytes=new Uint8Array(buf);
        let vo=null;
        for(let i=bytes.length-8;i>0;i--){
          if(bytes[i]===0x66&&bytes[i+1]===0x74&&bytes[i+2]===0x79&&bytes[i+3]===0x70){
            const off=i-4,v=new DataView(buf,off,4),len=v.getUint32(0,false);
            if(len>0&&len<buf.byteLength){vo=off;break}
          }
        }
        if(!vo){const t=new TextDecoder('utf-8').decode(buf);const m=t.match(/MediaDataOffset="(\d+)"/i)||t.match(/MicroVideoOffset="(\d+)"/i);if(m&&parseInt(m[1])>0)vo=buf.byteLength-parseInt(m[1])}
        if(!vo||vo<=0)return resolve(null);
        const ib=new Blob([buf.slice(0,vo)],{type:'image/jpeg'}),vb=new Blob([buf.slice(vo)],{type:'video/mp4'});
        resolve(vb.size>0?{imageBlob:ib,videoBlob:vb}:null);
      }catch(_){resolve(null)}
    };
    rd.onerror=()=>resolve(null);
    rd.readAsArrayBuffer(file);
  });
}

// ======== Image compression ========
function compImg(file,mw,q,webp){return new Promise((ok,no)=>{const img=new Image();img.onload=()=>{const w=Math.min(img.width,mw),h=img.height*w/img.width;const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,w,h);ctx.drawImage(img,0,0,w,h);c.toBlob(b=>{const m=webp?'image/webp':file.type;const ext=m==='image/webp'?'.webp':m==='image/png'?'.png':'.jpg';ok({blob:b,ext})},webp?'image/webp':file.type,q/100)};img.onerror=no;img.src=URL.createObjectURL(file)})}

// ======== CDN lazy loader (needM/needC 由 head-init.js 提供) ========