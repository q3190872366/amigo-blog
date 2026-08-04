// 本地后台服务：托管 admin 页面 + 提供本地文件读写 API（GitHub Contents API 的本地等价实现）
// 用法: node scripts/admin-local.mjs   (默认端口 8787，可用 PORT 环境变量覆盖)
// 后台 admin.js 在 8787 端口下会自动进入 LOCAL 模式，读写本地仓库文件，Hugo 热更新即时可见。
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { uploadBuffer, listObjects, presignedUrl } from './r2-client.mjs';
const BUCKET = process.env.R2_BUCKET || 'img';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');            // scripts/.. => 仓库根
const ADMIN = path.join(REPO, 'static', 'admin');     // 后台静态文件
const PORT = process.env.PORT || 8787;

const MIME = {
  '.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
  '.gif':'image/gif','.svg':'image/svg+xml','.md':'text/markdown; charset=utf-8','.toml':'text/plain; charset=utf-8',
  '.yml':'text/plain; charset=utf-8','.yaml':'text/plain; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff',
  '.ttf':'font/ttf','.ico':'image/x-icon'
};

function safeJoin(base, p){
  const fp = path.resolve(base, p);
  if(!fp.startsWith(base)) return null;
  return fp;
}
function sha1(buf){ return crypto.createHash('sha1').update(buf).digest('hex'); }
function sendJson(r, code, obj){ r.writeHead(code,{'Content-Type':'application/json'}); r.end(JSON.stringify(obj)); }

// 读取请求体（PUT/DELETE）
function readBody(r){
  return new Promise((resolve)=>{
    let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d));
  });
}

// ===== /api/contents/{path}  GitHub Contents 本地实现 =====
async function handleApiContents(r, method, repoPath, bodyStr){
  repoPath = repoPath.replace(/^\/+/,'');
  const fp = safeJoin(REPO, repoPath);
  if(!fp) return sendJson(r,403,{message:'Forbidden'});
  if(repoPath.split('/').includes('.git')) return sendJson(r,403,{message:'Forbidden'});
  try{
    if(method==='GET'){
      let st = await fs.stat(fp).catch(()=>null);
      if(!st) return sendJson(r,404,{message:'Not Found'});
      if(st.isDirectory()){
        const ents = await fs.readdir(fp,{withFileTypes:true});
        const arr = await Promise.all(ents.map(async (e)=>{
          const ep = path.join(fp,e.name);
          const est = await fs.stat(ep).catch(()=>({size:0}));
          const rel = (repoPath?repoPath+'/':'')+e.name;
          return {name:e.name, path:rel, type:e.isDirectory()?'dir':'file', sha:sha1(e.name),
                  size:est.size||0, url:'/api/contents/'+rel, download_url:'/api/raw/'+rel};
        }));
        // 目录在前，文件在后，保持稳定
        arr.sort((a,b)=> (a.type===b.type)? a.name.localeCompare(b.name) : (a.type==='dir'?-1:1));
        return sendJson(r,200,arr);
      }
      const buf = await fs.readFile(fp);
      const rel = repoPath;
      return sendJson(r,200,{name:path.basename(fp), path:rel, sha:sha1(buf), size:buf.length,
        url:'/api/contents/'+rel, html_url:'', git_url:'', download_url:'/api/raw/'+rel,
        type:'file', content:buf.toString('base64'), encoding:'base64'});
    }
    if(method==='PUT'){
      const body = JSON.parse(bodyStr||'{}');
      const content = body.content||'';
      const buf = Buffer.from(content,'base64');
      await fs.mkdir(path.dirname(fp),{recursive:true});
      await fs.writeFile(fp,buf);
      const rel = repoPath;
      return sendJson(r,200,{name:path.basename(fp), path:rel, sha:sha1(buf), size:buf.length,
        download_url:'/api/raw/'+rel, type:'file', content, encoding:'base64'});
    }
    if(method==='DELETE'){
      await fs.unlink(fp).catch(()=>{});
      // 若目录变空，尝试删除目录（忽略失败）
      try{ await fs.rmdir(path.dirname(fp)); }catch(_){}
      return sendJson(r,200,{});
    }
    return sendJson(r,405,{message:'Method Not Allowed'});
  }catch(e){ return sendJson(r,500,{message:e.message}); }
}

// ===== 直出文件（/api/raw 与 /static） =====
async function serveRaw(r, repoPath){
  repoPath = repoPath.replace(/^\/+/,'');
  const fp = safeJoin(REPO, repoPath);
  if(!fp){ r.writeHead(403); return r.end('Forbidden'); }
  try{
    const buf = await fs.readFile(fp);
    const ext = path.extname(fp).toLowerCase();
    r.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Cache-Control':'no-store'});
    r.end(buf);
  }catch(e){ r.writeHead(404); r.end('Not Found'); }
}

// ===== 托管后台静态文件 =====
async function serveStatic(r, urlPath){
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  rel = rel.replace(/^\/admin(?=\/|$)/,'/');     // 仅在 /admin 后接 / 或结尾时剥离
  if(rel==='/'||rel==='') rel='/index.html';
  const fp = safeJoin(ADMIN, rel.replace(/^\/+/,''));
  if(!fp){ r.writeHead(403); return r.end('Forbidden'); }
  try{
    let st = await fs.stat(fp);
    if(st.isDirectory()){
      const idx = path.join(fp,'index.html');
      if(await fs.stat(idx).catch(()=>null)){ return streamFile(r,idx); }
      r.writeHead(404); return r.end('Not Found');
    }
    return streamFile(r,fp);
  }catch(e){ r.writeHead(404); r.end('Not Found'); }
}
async function streamFile(r, fp){
  const buf = await fs.readFile(fp);
  const ext = path.extname(fp).toLowerCase();
  r.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});
  r.end(buf);
}

const server = http.createServer(async (r,res)=>{
  const u = new URL(r.url, 'http://localhost');
  const p = u.pathname;
  let bodyStr='';
  if(r.method==='PUT'||r.method==='POST'||r.method==='DELETE'){ bodyStr = await readBody(r); }
  try{
    if(p.startsWith('/api/contents')){
      const repoPath = decodeURIComponent(p.slice('/api/contents'.length));
      return await handleApiContents(res, r.method, repoPath, bodyStr);
    }
    if(p.startsWith('/api/raw')){
      return await serveRaw(res, decodeURIComponent(p.slice('/api/raw'.length)));
    }
    if(p.startsWith('/static/')){
      return await serveRaw(res, decodeURIComponent(p));
    }
    // R2 API
    if(p==='/api/r2/upload'&&r.method==='POST'){
      try{const{key,content,contentType}=JSON.parse(bodyStr||'{}');if(!key||!content)return sendJson(res,400,{message:'Missing key or content'});const buf=Buffer.from(content,'base64');await uploadBuffer(BUCKET,key,buf,contentType||'image/webp');return sendJson(res,200,{key,url:`https://pub-947aeedfef24715a5e45d50a7027f1d.r2.dev/${key}`,publicUrl:`https://pub-947aeedfef24715a5e45d50a7027f1d.r2.dev/${key}`})}catch(e){return sendJson(res,500,{message:e.message})}
    }
    if(p==='/api/r2/list'){
      try{const items=await listObjects(BUCKET,u.searchParams.get('prefix')||'');return sendJson(res,200,items)}catch(e){return sendJson(res,500,{message:e.message})}
    }
    if(p==='/api/r2/url'){
      const key=u.searchParams.get('key')||'';if(!key)return sendJson(res,400,{message:'Missing key'});try{return sendJson(res,200,{url:presignedUrl(BUCKET,key,86400)})}catch(e){return sendJson(res,500,{message:e.message})}
    }
    return await serveStatic(res, p);
  }catch(e){ sendJson(res,500,{message:e.message}); }
});

server.listen(PORT, ()=>console.log('本地后台已启动: http://localhost:'+PORT+'/   (仓库: '+REPO+')'));
