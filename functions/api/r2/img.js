// functions/api/r2/img.js — 图片代理：GET /api/r2/img?key=xxx → 返回 R2 原始图片
import { getCreds, signReq, sha256Hex, hmac, signKey, amzDate } from '../_r2-util.js';

function r2resp(status, body, headers = {}){
  const h = { 'Content-Type': 'text/plain;charset=utf-8', 'Access-Control-Allow-Origin': '*', ...headers };
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: h });
}

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return r2resp(204, '');
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if(!key || key.includes('..') || key.startsWith('/')) return r2resp(400, { message:'Missing or invalid key' });

  const creds = getCreds(env);
  if(!creds.ak) return r2resp(500, { message:'R2 凭据未配置' });

  try{
    const path = `/${creds.bucket}/${encodeURIComponent(key)}`;
    const h = await signReq('GET', path, '', {}, null, creds);
    const r = await fetch(`https://${creds.endpoint}${path}`, { method:'GET', headers:h });
    if(!r.ok) return r2resp(r.status, { message:`R2 fetch failed: ${r.status}` });

    const body = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'image/webp';
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }catch(e){ return r2resp(500, { message:e.message }); }
}