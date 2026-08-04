// functions/api/r2/serve.js — Cloudflare Pages Function（内联所有依赖，避免 import 链失败）
// GET /api/r2/serve?key=xxx
const AK_ENVVAR = 'R2_ACCESS_KEY_ID';
const SK_ENVVAR = 'R2_SECRET_ACCESS_KEY';
const ACCOUNT_ENVVAR = 'R2_ACCOUNT_ID';
const BUCKET_ENVVAR = 'R2_BUCKET';
const REGION = 'auto';
const SERVICE = 's3';

function sha256Hex(d){
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)).then(b=>{
    let s='';const u=new Uint8Array(b);for(const x of u)s+=x.toString(16).padStart(2,'0');return s;
  });
}
async function hmac(key, data){
  const raw = key instanceof ArrayBuffer ? key :
              (key.buffer instanceof ArrayBuffer ? key.buffer :
              new TextEncoder().encode(key));
  const k = await crypto.subtle.importKey('raw', raw, {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
async function signKey(secret, date, region){
  const k1 = await hmac('AWS4'+secret, date);
  const k2 = await hmac(k1, region);
  const k3 = await hmac(k2, SERVICE);
  return hmac(k3, 'aws4_request');
}
function amzDate(){
  return new Date().toISOString().replace(/[:-]|\.\d{3}/g,'');
}
async function signReq(method, path, query, extraHeaders, body, creds){
  const am = amzDate();
  const date = am.slice(0,8);
  const ph = body ? await sha256Hex(body) : 'UNSIGNED-PAYLOAD';
  const endpoint = creds.endpoint;
  const hdrs = { 'host': endpoint, 'x-amz-content-sha256': ph, 'x-amz-date': am, ...extraHeaders };
  if(body) hdrs['content-type'] = hdrs['content-type'] || 'application/octet-stream';
  const ks = Object.keys(hdrs).sort();
  const ch = ks.map(k => `${k}:${hdrs[k].trim()}`).join('\n');
  const sh = ks.join(';');
  const qp = query || '';
  const cr = [method, path, qp, ch, '', sh, ph].join('\n');
  const sts = ['AWS4-HMAC-SHA256', am, `${date}/${REGION}/${SERVICE}/aws4_request`, await sha256Hex(cr)].join('\n');
  const sk = await signKey(creds.sk, date, REGION);
  const sig = await hmac(sk, sts);
  let sigHex = '';
  for(const x of sig) sigHex += x.toString(16).padStart(2,'0');
  const auth = `AWS4-HMAC-SHA256 Credential=${creds.ak}/${date}/${REGION}/${SERVICE}/aws4_request, SignedHeaders=${sh}, Signature=${sigHex}`;
  return { ...hdrs, 'Authorization': auth, 'host': endpoint };
}

function corsResp(status, body, headers = {}){
  const h = { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', ...headers };
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: h });
}

export async function onRequest(context){
  const { request, env } = context;
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  if(!key) return corsResp(400, { message:'Missing key' });
  if(key.includes('..') || key.startsWith('/')) return corsResp(400, { message:'Invalid key' });

  const ak = env[AK_ENVVAR];
  const sk = env[SK_ENVVAR];
  const account = env[ACCOUNT_ENVVAR];
  const bucket = env[BUCKET_ENVVAR] || 'img';
  if(!ak || !sk || !account) return corsResp(500, { message:'R2 凭据未配置' });
  const endpoint = `${account}.r2.cloudflarestorage.com`;
  const creds = { ak, sk, endpoint };

  try{
    const path = `/${bucket}/${encodeURIComponent(key)}`;
    const h = await signReq('GET', path, '', {}, null, creds);
    const r = await fetch(`https://${endpoint}${path}`, { method:'GET', headers:h });
    if(!r.ok){
      return new Response(`R2 fetch failed: ${r.status}`, { status: r.status, headers:{ 'Content-Type':'text/plain;charset=utf-8' } });
    }
    const buf = await r.arrayBuffer();
    const ct = r.headers.get('content-type') || 'application/octet-stream';
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=604800, s-maxage=2592000',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }catch(e){
    return corsResp(500, { message: e.message });
  }
}