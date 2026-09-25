import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {buildRecoveryReceipt,buildRevocationReceipt,digest} from '../src/recovery-receipt.mjs';
import {decodeReceipt} from '../src/recovery-reconciliation.mjs';
import {buildDiscovery,discoverReceipts,signDiscovery,readDiscovery} from '../src/receipt-discovery.mjs';
import {createReceiptArchive} from '../src/runtime/receipt-archive.mjs';
const signing=generateKeyPairSync('ed25519'),recovery=generateKeyPairSync('rsa',{modulusLength:3072});
const privateKey=signing.privateKey.export({type:'pkcs8',format:'pem'}),publicKey=signing.publicKey.export({type:'spki',format:'pem'}),decryptKey=recovery.privateKey.export({type:'pkcs8',format:'pem'}),encryptKey=recovery.publicKey.export({type:'spki',format:'pem'});
function fixture(kind='business'){
 const objects=new Map(),rows=[],bundles=[];let state={value:0};
 for(let n=1;n<=3;n++){
  const authority={tenantId:'synthetic',businessId:'test',userId:'operator',role:'staff'},after={value:n};
  const built=kind==='business'?buildRecoveryReceipt({before:state,after,revision:String(n-1),authority,command:{action:'synthetic',body:{requestId:'request-'+n}},result:{value:n},occurredAt:'2026-09-25T00:00:00Z',publicKey:encryptKey}):buildRevocationReceipt({authority,sessionId:'synthetic-session-'+n,outcome:'revoked',occurredAt:'2026-09-25T00:00:00Z',publicKey:encryptKey});
  const row={tenant_id:'synthetic',business_id:'test',event_kind:kind,event_id:built.eventId,discovery_sequence:String(n),revision:kind==='business'?String(n):null,payload:built.payload,payload_digest:built.payloadDigest};
  const bundle=buildDiscovery(row,privateKey),entry=readDiscovery(bundle.entry,publicKey);objects.set(entry.objectName,row.payload);objects.set(bundle.paths.entry,bundle.entry);for(const node of bundle.nodes)objects.set(node.name,node.bytes);objects.set(bundle.paths.announcement,bundle.announcement);objects.set(bundle.paths.completion,bundle.completion);rows.push(row);bundles.push(bundle);state=after;
 }
 const run=(sequence='0')=>discoverReceipts({archiveQuiescent:true,baseline:{tenantId:'synthetic',businessId:'test',kind,sequence},publicKey,fetchObject:async name=>objects.get(name)??null,decode:bytes=>decodeReceipt(bytes,decryptKey)});
 return {objects,rows,bundles,run};
}
test('only baseline and known-name reads discover every completed business receipt; repeat is stable',async()=>{const f=fixture();const a=await f.run();assert.equal(a.highestCompletedSequence,'3');assert.deepEqual(a.records.map(r=>r.sequence),['1','2','3']);assert.deepEqual(await f.run(),a);assert.deepEqual((await f.run('3')).records,[]);});
test('security evidence uses a separate stream without business revisions',async()=>{const f=fixture('security'),r=await f.run();assert.equal(r.records.length,3);assert.ok(r.records.every(r=>r.payload.schema==='vega.security-termination.v1'));});
test('retry publication produces byte-identical discovery and completion records',()=>{const f=fixture();assert.deepEqual(buildDiscovery(f.rows[0],privateKey),f.bundles[0]);});
test('missing payload and missing middle completion fail closed',async()=>{let f=fixture();f.objects.delete(readDiscovery(f.bundles[1].entry,publicKey).objectName);await assert.rejects(f.run(),/missing or conflicting/);f=fixture();f.objects.delete(f.bundles[1].paths.completion);await assert.rejects(f.run(),/missing or conflicting completion/);});
test('modified signed completion and provider errors are not end-of-stream',async()=>{const f=fixture();f.objects.set(f.bundles[2].paths.completion,f.bundles[2].completion.replace('completion','alteration'));await assert.rejects(f.run(),/conflicting completion/);await assert.rejects(discoverReceipts({archiveQuiescent:true,baseline:{tenantId:'synthetic',businessId:'test',kind:'business',sequence:'0'},publicKey,fetchObject:async()=>{throw Error('provider unavailable');},decode:()=>{}}),/provider unavailable/);});
test('completion cannot hide a changed canonical payload digest',async()=>{const f=fixture(),b=f.bundles[1],entry=readDiscovery(b.entry,publicKey);f.objects.set(entry.objectName,'conflicting bytes');await assert.rejects(f.run(),/missing or conflicting/);});
test('same logical identity at a second security sequence is rejected',async()=>{const f=fixture('security'),row={...f.rows[0],discovery_sequence:'2'},b=buildDiscovery(row,privateKey);f.objects.set(b.paths.entry,b.entry);f.objects.set(b.paths.announcement,b.announcement);f.objects.set(b.paths.completion,b.completion);await assert.rejects(f.run(),/multiple sequences/);});

test('missing last completion is incomplete rather than an earlier end of stream',async()=>{const f=fixture();f.objects.delete(f.bundles[2].paths.completion);await assert.rejects(f.run(),/missing or conflicting completion/);});
test('missing tail announcement or routing branch cannot silently shorten completion',async()=>{let f=fixture();f.objects.delete(f.bundles[2].paths.announcement);await assert.rejects(f.run(),/Unindexed successor/);f=fixture();f.objects.delete(f.bundles[0].nodes[1].name);await assert.rejects(f.run(),/Unindexed successor/);});
test('missing index and announcement interior gaps fail closed',async()=>{let f=fixture();f.objects.delete(f.bundles[2].paths.entry);await assert.rejects(f.run(),/missing or conflicting index/);f=fixture();f.objects.delete(f.bundles[1].paths.announcement);await assert.rejects(f.run(),/Missing acknowledged sequence/);});

test('archive retries lost acknowledgments at every publication stage without changing bytes',async()=>{
 const original=fixture(),row=original.rows[0],bundle=original.bundles[0];
 const bucket='723a5face1abcc07a4080b1f',env={VEGA_ENV:'development',B2_BUCKET_ID:bucket,B2_FILE_PREFIX:'vega-development/',B2_APPLICATION_KEY_ID:'synthetic',B2_APPLICATION_KEY:'synthetic',RECEIPT_DISCOVERY_SIGNING_KEY:privateKey};
 const names=[...bundle.nodes.map(n=>n.name),bundle.paths.announcement,readDiscovery(bundle.entry,publicKey).objectName,bundle.paths.entry,bundle.paths.completion];
 for(const failingName of names){
  const objects=new Map(),versions=new Map();let lose=true;
  const archive=createReceiptArchive(env,async(url,options)=>{
   if(url.endsWith('b2_authorize_account'))return Response.json({authorizationToken:'synthetic',apiInfo:{storageApi:{apiUrl:'https://api001.backblazeb2.com',allowed:{buckets:[{id:bucket}],namePrefix:'vega-development/',capabilities:['writeFiles']}}}});
   if(url.endsWith('b2_get_upload_url'))return Response.json({uploadUrl:'https://pod-synthetic.backblazeb2.com/upload',authorizationToken:'synthetic'});
   const name=decodeURIComponent(options.headers['X-Bz-File-Name']),bytes=Buffer.from(options.body).toString('utf8');
   if(objects.has(name))assert.equal(objects.get(name),bytes);
   objects.set(name,bytes);versions.set(name,(versions.get(name)??0)+1);
   if(lose&&name===failingName){lose=false;throw Error('synthetic accepted upload with lost response');}
   return Response.json({bucketId:bucket,fileName:name,contentSha1:options.headers['X-Bz-Content-Sha1'],fileId:'synthetic-'+versions.get(name),uploadTimestamp:Date.now()});
  });
  await assert.rejects(archive.deliver(row));
  if(failingName!==bundle.paths.completion)assert.equal(objects.has(bundle.paths.completion),false);
  const ack=await archive.deliver(row);assert.equal(ack.discoverySequence,'1');assert.equal(objects.size,names.length);
  const result=await discoverReceipts({archiveQuiescent:true,baseline:{tenantId:'synthetic',businessId:'test',kind:'business',sequence:'0'},publicKey,fetchObject:async name=>objects.get(name)??null,decode:bytes=>decodeReceipt(bytes,decryptKey)});
  assert.equal(result.highestCompletedSequence,'1');assert.equal(result.records.length,1);
 }
});
