import { createServer } from 'node:http';
import { receiveSquareWebhook } from './square-webhook.mjs';

export function createDevelopmentServer(env = process.env, persistSquareEvent, checkIngestion) {
  if (env.VEGA_ENV !== 'development' || env.VEGA_EXTERNAL_EFFECTS !== 'disabled') {
    throw new Error('Vega development runtime requires external effects disabled');
  }
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
