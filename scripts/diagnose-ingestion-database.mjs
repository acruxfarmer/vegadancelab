import { writeFile } from 'node:fs/promises';
import { diagnoseRestrictedDatabase } from '../src/database-diagnostic.mjs';
try {
  let input='';for await(const chunk of process.stdin){input+=chunk;if(input.length>32768)throw new Error('Oversized input');}
  const data=JSON.parse(input);input='';
  const report={checkedAt:new Date().toISOString(),...await diagnoseRestrictedDatabase(data.databaseUrl)};
  await writeFile(new URL('../docs/ingestion-database-diagnostic.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report,null,2));
}catch{console.log(JSON.stringify({status:'diagnostic_incomplete',stage:'local_configuration',credentialsChanged:false}));process.exitCode=2;}
