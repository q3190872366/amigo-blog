// functions/api/r2/url.js — Cloudflare Pages Function
// GET /api/r2/url?key=xxx
import { getCreds, signReq, sha256Hex, hmac, signKey, amzDate, resp } from '../_r2-util.js';

export async function onRequest(context){
  const { request, env } = context;
  if(request.method === 'OPTIONS') return resp(204, '');
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if(!key) return resp(400, { message:'Missing key' });
  const creds = getCreds(env);
  if(!creds.ak || !creds.sk || !creds.endpoint) return resp(500, { message:'R2 凭据未配置' });
  try{
    const REGION='auto', SERVICE='s3';
    const am = amzDate();
    const date = am.slice(0,8);
    const credential = `${creds.ak}/${date}/${REGION}/${SERVICE}/aws4_request`;
    const sh = 'host';
    const expiresIn = 86400;
    const qs = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${encodeURIComponent(credential)}&X-Amz-Date=${am}&X-Amz-Expires=${expiresIn}&X-Amz-SignedHeaders=${sh}`;
    const path = `/${creds.bucket}/${encodeURIComponent(key)}`;
    const cr = ['GET', path, qs, `host:${creds.endpoint}`, '', sh, 'UNSIGNED-PAYLOAD'].join('\n');
    const sts = ['AWS4-HMAC-SHA256', am, `${date}/${REGION}/${SERVICE}/aws4_request`, await sha256Hex(cr)].join('\n');
    const sk = await signKey(creds.sk, date, REGION);
    const sig = await hmac(sk, sts);
    let sigHex = '';
    for(const x of sig) sigHex += x.toString(16).padStart(2,'0');
    return resp(200, { url: `https://${creds.endpoint}${path}?${qs}&X-Amz-Signature=${sigHex}` });
  }catch(e){ return resp(500, { message: e.message }); }
}