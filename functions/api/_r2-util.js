// functions/api/_r2-util.js — Cloudflare R2 S3 签名工具（共享给 /api/r2/* 端点）
// Workers 环境变量：
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY
// 兼容直接读 R2_* 形式或复用过 .r2-secrets.json 的字段

const ENDPOINT = (account) => `${account}.r2.cloudflarestorage.com`;
const REGION = 'auto';
const SERVICE = 's3';

function getCreds(env){
  return {
    ak: env.R2_ACCESS_KEY_ID,
    sk: env.R2_SECRET_ACCESS_KEY,
    account: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET || env.R2_BUCKET_NAME || 'img',
    endpoint: env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? ENDPOINT(env.R2_ACCOUNT_ID) : '')
  };
}

function sha256Hex(d){return crypto.subtle.digest('SHA-256', new TextEncoder().encode(d)).then(b=>{let s='';const u=new Uint8Array(b);for(const x of u)s+=x.toString(16).padStart(2,'0');return s})}

async function hmac(key, data){
  const k = await crypto.subtle.importKey('raw', key instanceof ArrayBuffer ? key : new TextEncoder().encode(key), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
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
  const n = new Date();
  return n.toISOString().replace(/[:-]|\.\d{3}/g,'');
}

async function signReq(method, path, query, extraHeaders, body, creds){
  const am = amzDate();
  const date = am.slice(0,8);
  const ph = body ? await sha256Hex(body) : 'UNSIGNED-PAYLOAD';
  const hdrs = { 'host': creds.endpoint, 'x-amz-content-sha256': ph, 'x-amz-date': am, ...extraHeaders };
  if(body) hdrs['content-type'] = hdrs['content-type'] || 'application/octet-stream';
  const ks = Object.keys(hdrs).sort();
  const ch = ks.map(k => `${k}:${hdrs[k].trim()}`).join('\n');
  const sh = ks.join(';');
  const qp = query || '';
  const cr = [method, path, qp, ch, '', sh, ph].join('\n');
  const sts = ['AWS4-HMAC-SHA256', am, `${date}/${REGION}/${SERVICE}/aws4_request`, await sha256Hex(cr)].join('\n');
  const sk = await signKey(creds.sk, date, REGION);
  const stsHash = await sha256Hex(sts);
  const finalSts = ['AWS4-HMAC-SHA256', am, `${date}/${REGION}/${SERVICE}/aws4_request`, stsHash].join('\n');
  const sig = await hmac(sk, finalSts);
  let sigHex = '';
  for(const x of sig) sigHex += x.toString(16).padStart(2,'0');
  const auth = `AWS4-HMAC-SHA256 Credential=${creds.ak}/${date}/${REGION}/${SERVICE}/aws4_request, SignedHeaders=${sh}, Signature=${sigHex}`;
  return { ...hdrs, 'Authorization': auth, 'host': creds.endpoint };
}

function resp(status, body, cors=true){
  const h = cors ? { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type' } : { 'Content-Type':'application/json' };
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: h });
}

export { getCreds, signReq, sha256Hex, hmac, signKey, amzDate, resp, ENDPOINT, REGION, SERVICE };