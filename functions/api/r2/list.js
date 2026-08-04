// functions/api/r2/list.js — Cloudflare Pages Function
// GET /api/r2/list?prefix=xxx
import { getCreds, signReq, resp } from '../_r2-util.js';

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return resp(204, '');
  const url = new URL(request.url);
  const prefix = url.searchParams.get('prefix') || '';
  const creds = getCreds(env);
  if(!creds.ak || !creds.sk || !creds.endpoint) return resp(500, { message: 'R2 凭据未配置（请在 Cloudflare Pages 设置环境变量 R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_ACCOUNT_ID）' });
  try{
    const qs = `list-type=2&max-keys=100${prefix ? '&prefix='+encodeURIComponent(prefix) : ''}`;
    const path = `/${creds.bucket}/?${qs}`;
    const h = await signReq('GET', `/${creds.bucket}/`, qs, {}, null, creds);
    const r = await fetch(`https://${creds.endpoint}${path}`, { method:'GET', headers:h });
    if(!r.ok) return resp(r.status, { message: `R2 list failed: ${r.status}` });
    const xml = await r.text();
    const out = []; const re = /<Contents>([\s\S]*?)<\/Contents>/g; let m;
    while((m = re.exec(xml)) !== null){
      const b = m[1];
      const key = (b.match(/<Key>([^<]+)<\/Key>/)||[])[1] || '';
      const size = parseInt((b.match(/<Size>(\d+)<\/Size>/)||[])[1] || '0');
      if(key) out.push({ key, size, lastModified: (b.match(/<LastModified>([^<]+)<\/LastModified>/)||[])[1] || '' });
    }
    return resp(200, out);
  }catch(e){ return resp(500, { message: e.message }); }
}