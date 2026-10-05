// Initial cloud service only: bind a private readiness port until disk-resident
// signing/TLS material is provisioned through the trusted Render shell.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
const root = process.env.ACRUX_JOURNAL_ROOT;
if(process.env.RENDER !== 'true' || !root || process.env.RENDER_API_KEY) throw Error('CLOUD_BOOTSTRAP_DENIED');
fs.mkdirSync(root,{recursive:true,mode:0o700});
const required = ['approval-public.pem','server-key.pem','server-cert.pem','credential-scopes.json'];
if(required.every(f=>fs.existsSync(path.join(root,f)))) {
  const child=spawn(process.execPath,['admin-plane/service.mjs'],{stdio:'inherit',env:process.env});
  process.on('SIGTERM',()=>child.kill('SIGTERM'));
  child.on('exit',code=>process.exit(code??1));
} else {
  http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end('{"status":"awaiting_cloud_private_provisioning","executionAuthorized":false}');}).listen(Number(process.env.PORT||10000),'0.0.0.0');
}
