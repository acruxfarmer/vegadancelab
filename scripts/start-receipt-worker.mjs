import {createReceiptWorker} from '../src/runtime/receipt-worker.mjs';
import {startWorkerPolling} from '../src/runtime/worker.mjs';
if(process.env.VEGA_ENV!=='development'||process.env.VEGA_EXTERNAL_EFFECTS!=='disabled')throw new Error('Development receipt worker only');
// Dedicated process: no Square polling, no business transitions, no external
// business effects. Independent archival delivery is its sole write purpose.
const worker=createReceiptWorker(process.env);
try{await worker.check();}catch{await worker.close();console.error('Restricted receipt worker readiness failed');process.exit(1);}
console.log(JSON.stringify({component:'independent-receipts',status:'restricted_worker_ready'}));
const stop=startWorkerPolling(worker,{onResult:r=>{if(r.processed||r.pending)console.log(JSON.stringify({component:'independent-receipts',...r}));},onError:()=>console.error('Receipt delivery unavailable; pending intents retained')});
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;await stop();});
