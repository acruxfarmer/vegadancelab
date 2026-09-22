import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequestJournal} from '../public/request-journal.js';
test('uncertain requests survive reload and stay scoped without persisting account or form contents',async()=>{
 const values=new Map(),storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
 const journal=createRequestJournal(storage),scope=['tenant','business','actor'],body={participantId:'member',reason:'private note',quantity:1};
 const a=await journal.acquire(scope,'/api/credits/issue',body);
 const reloaded=createRequestJournal(storage);assert.deepEqual(await reloaded.acquire(scope,'/api/credits/issue',body),a);
 const concurrent=await Promise.all([reloaded.acquire(scope,'/api/credits/issue',body),reloaded.acquire(scope,'/api/credits/issue',body)]);assert.deepEqual(concurrent,[a,a]);
 assert.notEqual((await reloaded.acquire(['tenant','business','other'],'/api/credits/issue',body)).requestId,a.requestId);
 assert.doesNotMatch(JSON.stringify([...values]),/private note|member|actor|tenant/);
 reloaded.complete(a);assert.notEqual((await reloaded.acquire(scope,'/api/credits/issue',body)).requestId,a.requestId);
});
test('unavailable tab persistence blocks before a command is sent',async()=>{
 await assert.rejects(createRequestJournal({getItem(){throw new Error('denied');}}).acquire(['actor'],'/api/credits/issue',{}),/storage is unavailable/);
});
