import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {createApplicationStore} from '../src/runtime/application-database.mjs';
import {emptyState} from '../src/application.mjs';
import {developmentOffer,OFFER_ID,PRODUCT_ID} from '../src/commerce.mjs';
test('concurrent draft commands serialize through the existing store and retain one durable receipt',async()=>{
 const user='e5946b40-9839-4a96-99d5-93262d9573f0',o=developmentOffer();
 let state={...emptyState(),participants:[{id:'vega-member-test-joe'}],entitlementProducts:[{id:PRODUCT_ID,name:o.productName,type:'class_pack',quantity:3,validDays:30,categories:o.categories,classIds:[]}]},revision=0,tail=Promise.resolve();
 const commands=new Map(),outbox=new Map();let updates=0;
 const pool={async connect(){let unlock;
  return {release(){},async query(sql,args){
   if(sql.startsWith('select tenant_id'))return {rows:[{tenant_id:'vega-development',business_id:'vega-dance-lab',role:'member',participant_ids:['vega-member-test-joe']}]};
   if(sql.startsWith('select state')){assert.match(sql,/for update$/);const previous=tail;tail=new Promise(resolve=>{unlock=resolve;});await previous;return {rows:[{state:structuredClone(state),revision}]};}
   if(sql.startsWith('select fingerprint'))return {rows:commands.has(args[3])?[commands.get(args[3])]:[]};
   if(sql.startsWith('select event_id,discovery_state'))return {rows:[outbox.get(args[3])]};
   if(sql.startsWith('update vega_private.app_state')){state=JSON.parse(args[0]);revision++;updates++;}
   if(sql.startsWith('insert into vega_private.app_commands'))commands.set(args[3],{fingerprint:args[4],response:JSON.parse(args[5])});
   if(sql.startsWith('insert into vega_private.recovery_outbox'))outbox.set(args[4],{event_id:args[0],state:'pending'});
   if(sql==='commit'||sql==='rollback')unlock?.();
   return {rows:[]};
  }};
 }};
 const receiptPublicKey=generateKeyPairSync('rsa',{modulusLength:3072}).publicKey.export({type:'spki',format:'pem'});
 const store=createApplicationStore(pool,{receiptPublicKey}),command={action:'purchase-draft',body:{requestId:'same-intent',offerId:OFFER_ID}};
 const [a,b]=await Promise.all([store.command(user,command),store.command(user,command)]);
 assert.deepEqual(a,b);assert.equal(updates,1);assert.equal(revision,1);assert.equal(commands.size,1);assert.equal(outbox.size,1);
 assert.equal(state.purchaseDrafts.length,1);assert.equal(state.activity.length,1);assert.deepEqual(state.passes,[]);
 await assert.rejects(store.command(user,{...command,body:{...command.body,offerId:'changed'}}),e=>e.status===409);
 assert.equal(updates,1);
});
