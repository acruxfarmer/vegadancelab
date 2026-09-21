import {createWorkerDatabase,startWorkerPolling} from '../src/runtime/worker.mjs';
if (process.env.VEGA_ENV !== 'development' || process.env.VEGA_EXTERNAL_EFFECTS !== 'disabled') {
  throw new Error('Vega development worker requires external effects disabled');
}
// Preserve the existing disabled bootstrap while the new restricted identity is handed off.
let stop;
if (!process.env.WORKER_DATABASE_URL) {
 console.log('Vega worker processing unavailable: restricted runtime handoff required');
 const timer=setInterval(()=>{},60000);stop=async()=>clearInterval(timer);
} else stop = startWorkerPolling(createWorkerDatabase(process.env.WORKER_DATABASE_URL), {onResult:r=>{if(r.processed||r.needsReview)console.log(JSON.stringify({component:'vega-worker',...r}));},onError:m=>console.error(m)});
let stopping=false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {if(stopping)return;stopping=true;await stop();});
}
