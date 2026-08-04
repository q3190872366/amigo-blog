// scripts/r2-config.mjs — R2 配置（凭据放 scripts/.r2-secrets.json 不入 git）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SECRET_FILE = path.join(__dirname, '.r2-secrets.json');
let cfg = {account:process.env.R2_ACCOUNT||'',accessKeyId:process.env.R2_ACCESS_KEY_ID||'',secretAccessKey:process.env.R2_SECRET_ACCESS_KEY||'',region:process.env.R2_REGION||'auto'};
try{const d=JSON.parse(fs.readFileSync(SECRET_FILE,'utf8'));cfg={...cfg,...d}}catch(_){}
cfg.endpoint=process.env.R2_ENDPOINT||(cfg.account?`${cfg.account}.r2.cloudflarestorage.com`:'');
export const R2=cfg;