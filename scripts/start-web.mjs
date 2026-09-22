import { createDevelopmentServer } from '../src/runtime/web.mjs';
import { createIngestionDatabase } from '../src/runtime/database.mjs';
import { createApplicationDatabase } from '../src/runtime/application-database.mjs';
import { attachHealthDiagnostics } from '../src/runtime/health-diagnostics.mjs';

let database;
try {
  if (process.env.DATABASE_URL) database = createIngestionDatabase(process.env.DATABASE_URL);
} catch { console.error('Vega development database configuration rejected'); process.exit(1); }
let application;
try{if(process.env.APP_DATABASE_URL)application=createApplicationDatabase(process.env.APP_DATABASE_URL);}catch{console.error('Vega application database configuration rejected');process.exit(1);}
const server = createDevelopmentServer(process.env, database?.persist, database?.check,application);
const diagnostics=attachHealthDiagnostics(server,{commit:process.env.RENDER_GIT_COMMIT});
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log('Vega development web runtime started; application readiness pending');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    diagnostics.signal(signal);
    server.close(async () => { try { await Promise.all([database?.close(),application?.close()]); } finally { process.exit(0); } });
    setTimeout(() => process.exit(1), 9000).unref();
  });
}
