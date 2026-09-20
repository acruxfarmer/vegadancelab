import { createDevelopmentServer } from '../src/runtime/web.mjs';

const server = createDevelopmentServer();
server.listen(Number(process.env.PORT || 10000), '0.0.0.0', () => {
  console.log('Vega development web runtime started; application readiness pending');
});
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 9000).unref();
  });
}
