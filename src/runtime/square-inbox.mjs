import { createHash } from 'node:crypto';

// query must resolve only after the database statement commits (autocommit).
// The login receives only vega_webhook_ingest membership, never owner privileges.
export function createSquareInboxWriter(query) {
  return async (event, rawBody) => {
    const digest = createHash('sha256').update(rawBody).digest('hex');
    const inserted = await query(`insert into vega_private.square_webhook_inbox
      (event_id, event_type, merchant_id, body_sha256, payload)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (event_id) do nothing returning event_id`,
    [event.event_id, event.type, event.merchant_id, digest, JSON.stringify(event)]);
    if (inserted.rows.length === 1) return 'stored';
    const previous = await query('select body_sha256 from vega_private.square_webhook_inbox where event_id = $1', [event.event_id]);
    if (previous.rows.length !== 1) throw new Error('Inbox verification unavailable');
    return previous.rows[0].body_sha256 === digest ? 'duplicate' : 'conflict';
  };
}
