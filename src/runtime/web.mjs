import { createServer } from 'node:http';

export function createDevelopmentServer(env = process.env) {
  if (env.VEGA_ENV !== 'development' || env.VEGA_EXTERNAL_EFFECTS !== 'disabled') {
    throw new Error('Vega development runtime requires external effects disabled');
  }
  return createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
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
