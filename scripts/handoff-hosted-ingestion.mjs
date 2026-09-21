import { writeFile } from 'node:fs/promises';
import { handoffIngestion } from '../src/hosted-ingestion-handoff.mjs';
try {
  let input='';
  for await(const chunk of process.stdin) { input+=chunk; if(input.length>65536) throw new Error('Input too large'); }
  const report={checkedAt:new Date().toISOString(),...await handoffIngestion(JSON.parse(input))};
  input='';
  await writeFile(new URL('../docs/hosted-ingestion-handoff.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if(report.status!=='ingestion_deployment_requested')process.exitCode=2;
}catch{console.log(JSON.stringify({status:'incomplete',stage:'local_handoff'}));process.exitCode=2;}
