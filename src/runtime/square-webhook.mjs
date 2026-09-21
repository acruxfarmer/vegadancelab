import { createHmac, timingSafeEqual } from 'node:crypto';

export const squareNotificationUrl = 'https://vega-development-web.onrender.com/webhooks/square';
export const squareEventTypes = new Set(['payment.created', 'payment.updated', 'refund.created', 'refund.updated']);

export function verifySquareSignature(rawBody, signature, key) {
  if (!key || typeof signature !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', key).update(squareNotificationUrl).update(rawBody).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}

export async function receiveSquareWebhook(req, res, env, persistEvent) {
  const reply = (status, code) => { res.writeHead(status); res.end(JSON.stringify({ status: code })); };
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); reply(405, 'method_not_allowed'); return; }
  if (env.SQUARE_ENVIRONMENT !== 'sandbox' || !env.SQUARE_WEBHOOK_SIGNATURE_KEY) {
    reply(503, 'webhook_configuration_pending'); return;
  }
  const chunks = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { reply(413, 'payload_too_large'); return; }
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks);
    if (!verifySquareSignature(rawBody, req.headers['x-square-hmacsha256-signature'], env.SQUARE_WEBHOOK_SIGNATURE_KEY)) {
      reply(401, 'invalid_signature'); return;
    }
    if (req.headers['square-environment'] !== 'Sandbox') { reply(403, 'sandbox_required'); return; }
    let event;
    try { event = JSON.parse(rawBody.toString('utf8')); } catch { reply(400, 'invalid_json'); return; }
    if (!event || typeof event.event_id !== 'string' || !event.event_id || event.event_id.length > 255 || typeof event.merchant_id !== 'string' || !event.merchant_id || event.merchant_id.length > 255 || !squareEventTypes.has(event.type)) {
      reply(400, 'unsupported_event'); return;
    }
    // Never acknowledge an event until durable, idempotent storage is available.
    // No payment state changes or payload logging occur during foundation setup.
    if (!persistEvent) { res.setHeader('Retry-After', '60'); reply(503, 'durable_inbox_pending'); return; }
    try {
      const outcome = await persistEvent(event, rawBody);
      if (outcome === 'conflict') { reply(409, 'event_identity_conflict'); return; }
      if (!['stored', 'duplicate'].includes(outcome)) throw new Error('Invalid storage result');
      reply(200, outcome);
    } catch { res.setHeader('Retry-After', '60'); reply(503, 'durable_inbox_unavailable'); }
  } catch {
    if (!res.headersSent) reply(400, 'invalid_request');
  }
}
