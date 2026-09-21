import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseRestrictedDatabase } from '../src/database-diagnostic.mjs';
const url='postgresql://vega_ingest_runtime.cjdoczrxcjynjhgpgqop:synthetic-password@aws-0-us-west-1.pooler.supabase.com:5432/postgres';
for(const code of ['SELF_SIGNED_CERT_IN_CHAIN','28P01']) {
  test(`restricted diagnostic classifies ${code} without exposing error text or changing TLS`,async()=>{
    let count=0;
    class Client {
      constructor(config){count++;assert.equal(config.user,'vega_ingest_runtime.cjdoczrxcjynjhgpgqop');assert.equal(config.ssl.rejectUnauthorized,true);}
      async connect(){throw Object.assign(new Error('synthetic-password'),{code});}
      async end(){}
    }
    const result=await diagnoseRestrictedDatabase(url,{Client});
    assert.equal(count,1);assert.equal(result.field,'DATABASE_URL');assert.equal(result.item,'Vega Dev - Supabase');
    assert.deepEqual(result.codes,[code]);assert.equal(result.operatorConnectionAttempted,false);
    assert.doesNotMatch(JSON.stringify(result),/synthetic-password/);
    if(code==='SELF_SIGNED_CERT_IN_CHAIN')assert.equal(result.authentication,'not_reached');
  });
}
