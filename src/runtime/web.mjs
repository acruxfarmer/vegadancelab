import { createServer } from 'node:http';
import { receiveSquareWebhook } from './square-webhook.mjs';
import { readFile } from 'node:fs/promises';
import { createApplicationApi } from './application-api.mjs';

export function createDevelopmentServer(env = process.env, persistSquareEvent, checkIngestion, applicationStore) {
  if (env.VEGA_ENV !== 'development' || env.VEGA_EXTERNAL_EFFECTS !== 'disabled') {
    throw new Error('Vega development runtime requires external effects disabled');
  }
  const api=createApplicationApi(env,applicationStore);
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(req.method==='GET'&&req.url==='/health/application'){
      void(async()=>{try{if(!applicationStore||env.SUPABASE_URL!=='https://cjdoczrxcjynjhgpgqop.supabase.co'||!env.SUPABASE_PUBLISHABLE_KEY)throw new Error();await applicationStore.check();res.writeHead(200);res.end(JSON.stringify({status:'application_runtime_ready',environment:'development',squareEnabled:false}));}catch{res.writeHead(503);res.end(JSON.stringify({status:'application_runtime_unavailable',squareEnabled:false}));}})();return;
    }
    if(req.url.startsWith('/api/')){void api(req,res);return;}
    const files={'/entitlements-ui.js':['entitlements-ui.js','text/javascript; charset=utf-8'],'/cancellation-ui.js':['cancellation-ui.js','text/javascript; charset=utf-8'],'/session.js':['session.js','text/javascript; charset=utf-8'],'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/integration.js':['integration.js','text/javascript; charset=utf-8'],'/styles.css':['styles.css','text/css; charset=utf-8']};
    files['/member-booking.js']=['member-booking.js','text/javascript; charset=utf-8'];
    files['/member-cancellation.js']=['member-cancellation.js','text/javascript; charset=utf-8'];
    files['/member-portal.js']=['member-portal.js','text/javascript; charset=utf-8'];
    const asset=files[req.url.split('?')[0]];
    if(asset&&req.method==='GET'){
      void readFile(new URL(`../../public/${asset[0]}`,import.meta.url)).then(body=>{res.writeHead(200,{'Content-Type':asset[1]});res.end(body);}).catch(()=>{res.writeHead(503);res.end(JSON.stringify({error:'Application assets unavailable'}));});return;
    }
    if (req.method === 'GET' && req.url === '/health/ingestion') {
      void (async () => {
        try {
          if (!checkIngestion || !persistSquareEvent || env.SQUARE_ENVIRONMENT !== 'sandbox' || !env.SQUARE_WEBHOOK_SIGNATURE_KEY || env.SQUARE_WEBHOOK_NOTIFICATION_URL !== 'https://vega-development-web.onrender.com/webhooks/square') throw new Error('Not configured');
          await checkIngestion();
          res.writeHead(200); res.end(JSON.stringify({ status: 'durable_ingestion_ready', environment: 'development' }));
        } catch { res.writeHead(503); res.end(JSON.stringify({ status: 'durable_ingestion_unavailable' })); }
      })();
      return;
    }
    if (req.url === '/webhooks/square') {
      void receiveSquareWebhook(req, res, env, persistSquareEvent);
      return;
    }
    if (req.method === 'GET' && req.url === '/health/live') {
      res.writeHead(200);
      res.end(JSON.stringify({ application: 'vega', environment: 'development', status: 'alive' }));
      return;
    }
    // Deployment liveness is not evidence that provider credentials are configured.
    res.writeHead(503);
    res.end(JSON.stringify({ status: 'foundation_setup_pending' }));
  });
}
