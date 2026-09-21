import { createDevelopmentServer } from '../src/runtime/web.mjs';
import { createIngestionDatabase } from '../src/runtime/database.mjs';

let database;
try {
  if (process.env.DATABASE_URL) database = createIngestionDatabase(process.env.DATABASE_URL);
} catch { console.error('Vega development database configuration rejected'); process.exit(1); }
const server = createDevelopmentServer(process.env, database?.persist, database?.check);
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log('Vega development web runtime started; application readiness pending');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(async () => { try { await database?.close(); } finally { process.exit(0); } });
    setTimeout(() => process.exit(1), 9000).unref();
  });
}
