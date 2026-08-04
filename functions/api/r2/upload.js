// functions/api/r2/upload.js — Cloudflare Pages Function
// POST /api/r2/upload   body: {key,content(base64),contentType}
import { getCreds, signReq, signKey, sha256Hex, hmac, amzDate, resp } from '../_r2-util.js';

const REGION='auto', SERVICE='s3';

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return resp(204, '');
  if(request.method !== 'POST') return resp(405, { message:'Method not allowed' });
  const creds = getCreds(env);
  if(!creds.ak || !creds.sk || !creds.endpoint) return resp(500, { message: 'R2 凭据未配置' });
  try{
    const body = await request.json();
    const { key, content, contentType } = body || {};
    if(!key || !content) return resp(400, { message: 'Missing key or content' });
    // base64 -> bytes
    const bin = atob(content);
    const bytes = new Uint8Array(bin.length);
    for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const path = `/${creds.bucket}/${encodeURIComponent(key)}`;
    const h = await signReq('PUT', path, '', { 'content-type': contentType || 'image/webp' }, bin, creds);
    const r = await fetch(`https://${creds.endpoint}${path}`, { method:'PUT', headers:h, body: bytes });
    if(!r.ok) return resp(r.status, { message: `R2 upload failed: ${r.status}` });

    // 同时生成 7 天 presigned URL（可直接作 <img src>）
    const am = amzDate();
    const date = am.slice(0,8);
    const credential = `${creds.ak}/${date}/${REGION}/${SERVICE}/aws4_request`;
    const sh = 'host';
    const expiresIn = 86400 * 7;
    const qs = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credential)}&X-Amz-Date=${am}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=${sh}`;
    const cr = ['GET', path, qs, `host:${creds.endpoint}`, '', sh, 'UNSIGNED-PAYLOAD'].join('\n');
    const sts = ['AWS4-HMAC-SHA256', am, `${date}/${REGION}/${SERVICE}/aws4_request`, await sha256Hex(cr)].join('\n');
    const sk = await signKey(creds.sk, date, REGION);
    const sig = await hmac(sk, sts);
    let sigHex = '';
    for(const x of sig) sigHex += x.toString(16).padStart(2,'0');
    const presignedUrl = `https://${creds.endpoint}${path}?${qs}&X-Amz-Signature=${sigHex}`;

    return resp(200, { key, url: presignedUrl, presignedUrl, bucket: creds.bucket });
  }catch(e){ return resp(500, { message: e.message }); }
}