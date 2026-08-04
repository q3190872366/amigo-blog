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
    const h = await signReq('PUT', path, '', { 'content-type': contentType || 'image/webp', 'x-amz-acl': 'public-read' }, bytes, creds);
    const r = await fetch(`https://${creds.endpoint}${path}`, { method:'PUT', headers:h, body: bytes });
    if(!r.ok) return resp(r.status, { message: `R2 upload failed: ${r.status}` });

    const publicUrl = `https://pub-947aeedfef24715a5e45d50a7027f1d.r2.dev/${key}`;
    return resp(200, { key, url: publicUrl, publicUrl, bucket: creds.bucket });
  }catch(e){ return resp(500, { message: e.message }); }
}