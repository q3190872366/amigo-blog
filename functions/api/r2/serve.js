// functions/api/r2/serve.js — Cloudflare Pages Function
// GET /api/r2/serve?key=xxx   通过 Pages Function 代理 R2 对象
import { getCreds, signReq, resp } from '../../_r2-util.js';

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return resp(204, '');
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  // 防路径穿越
  if(key.includes('..')||key.startsWith('/')) return resp(400, { message:'Invalid key' });

  const creds = getCreds(env);
  if(!creds.ak || !creds.sk || !creds.endpoint) return resp(500, { message:'R2 凭据未配置' });
  try{
    const path = `/${creds.bucket}/${encodeURIComponent(key)}`;
    const h = await signReq('GET', path, '', {}, null, creds);
    const r = await fetch(`https://${creds.endpoint}${path}`, { method:'GET', headers:h });
    if(!r.ok){
      const t = await r.text();
      return new Response(t, { status: r.status, headers:{ 'Content-Type':'text/plain;charset=utf-8' } });
    }
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    // 图片缓存：边缘节点 30 天，浏览器 7 天
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }catch(e){
    return resp(500, { message: e.message });
  }
}