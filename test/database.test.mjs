import test from 'node:test';
import assert from 'node:assert/strict';
import { databaseOptions, checkIngestionDatabase } from '../src/runtime/database.mjs';
test('database config pins project and runtime identity with strict TLS', () => {
  const url='postgresql://vega_ingest_runtime.cjdoczrxcjynjhgpgqop:synthetic@aws-0-us-west-1.pooler.supabase.com:5432/postgres?sslmode=disable';
  assert.equal(databaseOptions(url).ssl.rejectUnauthorized,true);
  assert.throws(()=>databaseOptions(url.replace('vega_ingest_runtime','postgres')));
  assert.throws(()=>databaseOptions(url.replace('cjdoczrxcjynjhgpgqop','wrong-project')));
  assert.throws(()=>databaseOptions(url.replace('pooler.supabase.com','attacker.invalid')));
});
test('readiness rejects privilege escalation, ownership, and missing RLS', async () => {
  const safe={role:'vega_ingest_runtime',elevated:false,can_select:true,can_insert:true,can_mutate:false,forced_rls:true,owns_table:false,inherits_ingest:true,other_membership:false};
  assert.equal(await checkIngestionDatabase(async()=>({rows:[safe]})),true);
  for(const [key,value] of [['elevated',true],['can_mutate',true],['forced_rls',false],['owns_table',true],['inherits_ingest',false],['other_membership',true]]) {
    await assert.rejects(checkIngestionDatabase(async()=>({rows:[{...safe,[key]:value}]})));
  }
});
