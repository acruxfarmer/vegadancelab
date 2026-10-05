import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Journal} from './journal.mjs';

export function createService(journal, tls) {
  return https.createServer({...tls,minVersion:'TLSv1.2'}, async (req,res) => {
    res.setHeader('Content-Type','application/json'); res.setHeader('Cache-Control','no-store');
    try {
      if (req.method !== 'POST' || !['/claim','/append','/inspect'].includes(req.url)) throw Error();
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 16384) throw Error(); }
      const body = JSON.parse(raw), token = req.headers.authorization?.replace(/^Bearer /,'');
      let result;
      if (req.url === '/claim') result = journal.claim(body.envelope,token);
      if (req.url === '/append') result = journal.append(body.envelope,token,body.state,body.evidence);
      if (req.url === '/inspect') result = journal.inspect(body.manifestDigest,token);
      res.end(JSON.stringify({ok:true,result}));
    } catch { res.statusCode = 403; res.end('{"ok":false,"code":"JOURNAL_REQUEST_DENIED"}'); }
  });
}

// TLS and approval keys are disk-resident: inherited one-off-job environment does
// not contain the signing key or server private key. There is no approval HTTP API.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.env.ACRUX_JOURNAL_ROOT;
  if (!root || process.env.RENDER_API_KEY || process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw Error('SERVICE_CONFIGURATION_DENIED');
  const read = name => fs.readFileSync(path.join(root,name));
  const journal = new Journal(root,read('approval-public.pem'),JSON.parse(read('credential-scopes.json')));
  const server = createService(journal,{key:read('server-key.pem'),cert:read('server-cert.pem')});
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  server.listen(Number(process.env.PORT || 10000),'0.0.0.0');
  // On termination preserve lock until explicit cloud recovery; no automatic lock stealing.
}
