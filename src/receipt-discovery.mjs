import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';
import {canonical,digest} from './recovery-receipt.mjs';
export const discoveryVersion='vega.receipt-discovery.v1';
const prefix='vega-development/independent-discovery/v1/',max=9223372036854775807n;
export function sequence(value){if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value)||BigInt(value)>max)throw Error('Invalid discovery sequence');return BigInt(value);}
export function streamIdentity(tenantId,businessId,kind){if(!tenantId||!businessId||!['business','security'].includes(kind))throw Error('Invalid discovery stream');return {tenantId,businessId,kind,streamId:digest(canonical([discoveryVersion,tenantId,businessId,kind]))};}
export function discoveryPaths(streamId,value){if(!/^[a-f0-9]{64}$/.test(streamId))throw Error('Invalid stream');const n=sequence(value);if(n===0n)throw Error('Sequence zero is reserved');const hex=n.toString(16).padStart(16,'0'),base=prefix+streamId+'/';return {hex,entry:base+'entries/'+hex+'.json',announcement:base+'tree/'+hex+'.json',completion:base+'completed/'+hex+'.json',nodes:Array.from({length:16},(_,i)=>base+'tree/'+(i?hex.slice(0,i):'root')+'.json')};}
export function signDiscovery(body,key){const privateKey=createPrivateKey(key);if(privateKey.asymmetricKeyType!=='ed25519')throw Error('Discovery signing key must be Ed25519');const keyId=digest(createPublicKey(privateKey).export({type:'spki',format:'der'}));const record={...body,schema:discoveryVersion,keyId};return canonical({record,signature:sign(null,Buffer.from(canonical(record)),privateKey).toString('base64')});}
export function readDiscovery(bytes,key){const publicKey=createPublicKey(key);if(publicKey.asymmetricKeyType!=='ed25519')throw Error('Wrong verification key');const value=JSON.parse(bytes),keyId=digest(publicKey.export({type:'spki',format:'der'}));if(value.record?.schema!==discoveryVersion||value.record.keyId!==keyId||!verify(null,Buffer.from(canonical(value.record)),publicKey,Buffer.from(value.signature??'','base64')))throw Error('Discovery integrity rejected');return value.record;}
export function buildDiscovery(row,key){
 const stream=streamIdentity(row.tenant_id,row.business_id,row.event_kind),n=sequence(row.discovery_sequence);if(n===0n||!/^[a-f0-9]{64}$/.test(row.event_id)||digest(row.payload)!==row.payload_digest)throw Error('Invalid receipt binding');
 if(row.event_kind==='business'&&String(row.revision)!==String(n))throw Error('Business discovery revision mismatch');
 const paths=discoveryPaths(stream.streamId,String(n));
 const objectName='vega-development/independent-receipts/v1/'+digest(JSON.stringify([row.tenant_id,row.business_id]))+'/'+row.event_id+'/'+row.payload_digest+'.json';
 const entry=signDiscovery({type:'entry',...stream,sequence:String(n),previousSequence:String(n-1n),eventId:row.event_id,payloadDigest:row.payload_digest,objectName},key);
 const nodes=paths.nodes.map((name,i)=>({name,bytes:signDiscovery({type:'branch',...stream,hexPrefix:i?paths.hex.slice(0,i):''},key)}));
 const completion=signDiscovery({type:'completion',...stream,sequence:String(n),entryName:paths.entry,entryDigest:digest(entry)},key);
 const announcement=signDiscovery({type:'announcement',...stream,sequence:String(n),completionName:paths.completion,completionDigest:digest(completion)},key);
 return {stream,paths,entry,nodes,announcement,completion};
}
// fetchObject returns null ONLY for a confirmed missing object, never for auth,
// transport, timeout or provider errors. No primary DB or bucket listing interface.
export async function discoverReceipts({baseline,publicKey,fetchObject,decode,maxReads=20000,archiveQuiescent=false}){
 if(archiveQuiescent!==true)throw Error('Establish archive publication quiescence before certifying completion');
 const stream=streamIdentity(baseline.tenantId,baseline.businessId,baseline.kind),floor=sequence(baseline.sequence),base=prefix+stream.streamId+'/',records=[],seen=new Map();let reads=0;
 const read=async name=>{if(++reads>maxReads)throw Error('Discovery read bound exceeded');return fetchObject(name);};
 const scoped=r=>{if(r.streamId!==stream.streamId||r.tenantId!==stream.tenantId||r.businessId!==stream.businessId||r.kind!==stream.kind)throw Error('Discovery scope mismatch');};
 async function walk(hex,required=false){
  const name=base+'tree/'+(hex||'root')+'.json',bytes=await read(name);if(bytes===null){if(required)throw Error('Required discovery root missing');return false;}
  const r=readDiscovery(bytes,publicKey);scoped(r);
  if(hex.length<16){if(r.type!=='branch'||r.hexPrefix!==hex)throw Error('Invalid discovery branch');let children=0,eligible=0;
   for(const digit of '0123456789abcdef'){const child=hex+digit,lo=BigInt('0x'+child.padEnd(16,'0')),hi=BigInt('0x'+child.padEnd(16,'f'));if(lo>max||hi<=floor)continue;eligible++;if(await walk(child))children++;}
   // Root may represent an initialized empty stream. A nonroot dangling branch
   // above the baseline is an interrupted publication, not a clean end marker.
   if(hex&&BigInt('0x'+hex.padEnd(16,'0'))>floor&&eligible&&children===0)throw Error('Incomplete discovery branch');return true;
  }
  const n=BigInt('0x'+hex),paths=discoveryPaths(stream.streamId,String(n));
  if(r.type!=='announcement'||r.sequence!==String(n)||r.completionName!==paths.completion)throw Error('Invalid publication announcement');
  const completed=await read(paths.completion);if(completed===null||digest(completed)!==r.completionDigest)throw Error('Announced sequence has missing or conflicting completion');
  const completion=readDiscovery(completed,publicKey);scoped(completion);
  if(completion.type!=='completion'||completion.sequence!==String(n)||completion.entryName!==paths.entry)throw Error('Invalid completion checkpoint');
  const entryBytes=await read(paths.entry);if(entryBytes===null||digest(entryBytes)!==completion.entryDigest)throw Error('Completion references missing or conflicting index');
  const entry=readDiscovery(entryBytes,publicKey);scoped(entry);if(entry.type!=='entry'||entry.sequence!==String(n)||entry.previousSequence!==String(n-1n))throw Error('Index sequence mismatch');
  const expectedName='vega-development/independent-receipts/v1/'+digest(JSON.stringify([stream.tenantId,stream.businessId]))+'/'+entry.eventId+'/'+entry.payloadDigest+'.json';
  if(!/^[a-f0-9]{64}$/.test(entry.eventId)||!/^[a-f0-9]{64}$/.test(entry.payloadDigest)||entry.objectName!==expectedName)throw Error('Invalid canonical object binding');
  const payload=await read(entry.objectName);if(payload===null||digest(payload)!==entry.payloadDigest)throw Error('Required canonical receipt missing or conflicting');
  const decoded=await decode(payload);if(decoded.eventId!==entry.eventId||decoded.operation.tenantId!==stream.tenantId||decoded.operation.businessId!==stream.businessId)throw Error('Canonical operation mismatch');
  if(stream.kind==='business'?(decoded.schema!=='vega.committed-result.v1'||decoded.revision!==String(n)||decoded.previousRevision!==String(n-1n)):decoded.schema!=='vega.security-termination.v1')throw Error('Canonical stream mismatch');
  if(seen.has(entry.eventId)){if(seen.get(entry.eventId)!==entry.payloadDigest)throw Error('Conflicting logical receipt');throw Error('Logical identity assigned multiple sequences');}
  seen.set(entry.eventId,entry.payloadDigest);records.push({sequence:String(n),eventId:entry.eventId,payloadDigest:entry.payloadDigest,payload:decoded});return true;
 }
 await walk('',true);records.sort((a,b)=>sequence(a.sequence)<sequence(b.sequence)?-1:1);
 let next=floor+1n;for(const r of records){if(sequence(r.sequence)!==next)throw Error('Missing acknowledged sequence');next++;}
 // A missing routing/announcement object must not conceal a contiguous tail.
 // Probe its first sequence directly, independently of the tree traversal.
 if(next<=max){const paths=discoveryPaths(stream.streamId,String(next));for(const name of [paths.announcement,paths.entry,paths.completion])if(await read(name)!==null)throw Error('Unindexed successor publication; recovery incomplete');}
 return {stream,baselineSequence:String(floor),highestCompletedSequence:String(next-1n),records,reads,unarchivedWork:'not established by completion evidence'};
}
