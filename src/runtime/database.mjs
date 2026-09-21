import pg from 'pg';
import { createSquareInboxWriter } from './square-inbox.mjs';
import { databaseTls } from './database-tls.mjs';

export const projectRef = 'cjdoczrxcjynjhgpgqop';
export const runtimeRole = 'vega_ingest_runtime';
export function databaseOptions(value, { operator = false } = {}) {
  const url = new URL(value);
  const role = operator ? 'postgres' : runtimeRole;
  const direct = url.hostname === `db.${projectRef}.supabase.co`;
  const pooler = /^aws-\d+-us-west-1\.pooler\.supabase\.com$/.test(url.hostname);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler) || url.pathname !== '/postgres' || !['5432','6543',''].includes(url.port) || decodeURIComponent(url.username) !== (direct ? role : `${role}.${projectRef}`) || !url.password) throw new Error('Invalid development database configuration');
  // Construct explicit properties: URL SSL flags can never disable verification.
  return { host: url.hostname, port: Number(url.port || 5432), database: 'postgres', user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), ssl: databaseTls(url.hostname), connectionTimeoutMillis: 10000, statement_timeout: 10000, query_timeout: 12000, application_name: operator ? 'vega-ingestion-provision' : 'vega-development-ingest' };
}
export async function checkIngestionDatabase(query) {
  const { rows } = await query(`select current_user as role,
    r.rolsuper or r.rolcreatedb or r.rolcreaterole or r.rolreplication or r.rolbypassrls as elevated,
    has_table_privilege(current_user,'vega_private.square_webhook_inbox','SELECT') as can_select,
    has_table_privilege(current_user,'vega_private.square_webhook_inbox','INSERT') as can_insert,
    has_table_privilege(current_user,'vega_private.square_webhook_inbox','UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES') as can_mutate,
    c.relrowsecurity and c.relforcerowsecurity as forced_rls,
    c.relowner = r.oid as owns_table,
    exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid and p.rolname='vega_webhook_ingest' and m.inherit_option and not m.admin_option) as inherits_ingest,
    exists(select 1 from pg_auth_members m join pg_roles p on p.oid=m.roleid where m.member=r.oid and p.rolname<>'vega_webhook_ingest') as other_membership
    from pg_roles r cross join pg_class c join pg_namespace n on n.oid=c.relnamespace
    where r.rolname=current_user and n.nspname='vega_private' and c.relname='square_webhook_inbox'`);
  const r = rows[0];
  if (rows.length !== 1 || r.role !== runtimeRole || r.elevated || !r.can_select || !r.can_insert || r.can_mutate || !r.forced_rls || r.owns_table || !r.inherits_ingest || r.other_membership) throw new Error('Restricted ingestion access not verified');
  return true;
}
export function createIngestionDatabase(value) {
  const pool = new pg.Pool({ ...databaseOptions(value), max: 3, idleTimeoutMillis: 30000 });
  pool.on('error', () => { /* Request/readiness probes report sanitized failure. */ });
  const query = (sql, values) => pool.query(sql, values);
  const write = createSquareInboxWriter(query);
  return { check: () => checkIngestionDatabase(query), persist: async (event, body) => { await checkIngestionDatabase(query); return write(event, body); }, close: () => pool.end() };
}
