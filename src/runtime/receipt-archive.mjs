import {createHash} from 'node:crypto';
import {digest} from '../recovery-receipt.mjs';
import {buildDiscovery,signDiscovery} from '../receipt-discovery.mjs';
const bucket='723a5face1abcc07a4080b1f',prefix='vega-development/';
function provider(value,kind){const u=new URL(value);const hosts={api:/^api\d+\.backblazeb2\.com$/,upload:/^pod-[a-z0-9-]+\.backblaze(?:b2)?\.com$/};if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts[kind].test(u.hostname))throw new Error('Archive provider host rejected');return u;}
export function createReceiptArchive(env,fetcher=fetch){
 if(env.VEGA_ENV!=='development'||env.B2_BUCKET_ID!==bucket||env.B2_FILE_PREFIX!==prefix||!env.B2_APPLICATION_KEY_ID||!env.B2_APPLICATION_KEY)throw new Error('Development receipt archive configuration required');
 signDiscovery({type:'configuration-check'},env.RECEIPT_DISCOVERY_SIGNING_KEY);
 async function call(url,options={}){const r=await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Archive request unconfirmed');return r;}
 return {deliver:async row=>{
  const discovery=buildDiscovery(row,env.RECEIPT_DISCOVERY_SIGNING_KEY);
  if(!/^[a-f0-9]{64}$/.test(row.event_id)||digest(row.payload)!==row.payload_digest)throw new Error('Receipt payload integrity rejected');
  const auth=await(await call('https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{headers:{Authorization:'Basic '+Buffer.from(`${env.B2_APPLICATION_KEY_ID.trim()}:${env.B2_APPLICATION_KEY.trim()}`).toString('base64')}})).json();
  const storage=auth.apiInfo?.storageApi,allowed=storage?.allowed;
  if(allowed?.buckets?.length!==1||allowed.buckets[0].id!==bucket||allowed.namePrefix!==prefix||allowed.capabilities?.length!==1||allowed.capabilities[0]!=='writeFiles')throw new Error('Existing archive writer scope rejected');
  const api=provider(storage.apiUrl,'api');
  const upload=await(await call(`${api.origin}/b2api/v4/b2_get_upload_url`,{method:'POST',headers:{Authorization:auth.authorizationToken,'Content-Type':'application/json'},body:JSON.stringify({bucketId:bucket})})).json();
  const url=provider(upload.uploadUrl,'upload');
  const name=`${prefix}independent-receipts/v1/${digest(JSON.stringify([row.tenant_id,row.business_id]))}/${row.event_id}/${row.payload_digest}.json`;
  async function put(objectName,content){
  const bytes=Buffer.from(content),sha1=createHash('sha1').update(bytes).digest('hex');
  // A retry sends the persisted bytes verbatim. B2 may retain multiple physical
  // versions, all representing this same logical receipt and payload digest.
  const stored=await(await call(url.href,{method:'POST',headers:{Authorization:upload.authorizationToken,'Content-Type':'application/json','Content-Length':String(bytes.length),'X-Bz-File-Name':encodeURIComponent(objectName),'X-Bz-Content-Sha1':sha1,'X-Bz-Info-receipt-sha256':digest(bytes)},body:bytes})).json();
  if(stored.bucketId!==bucket||stored.fileName!==objectName||stored.contentSha1!==sha1||typeof stored.fileId!=='string'||!stored.fileId||!Number.isFinite(stored.uploadTimestamp))throw new Error('Archive acknowledgment rejected');
  return stored;
  }
  // Announce first; an interrupted publication is observable independently.
  // Branch markers and signatures are immutable, including on delayed retries.
  for(const node of discovery.nodes)await put(node.name,node.bytes);
  await put(discovery.paths.announcement,discovery.announcement);
  const stored=await put(name,row.payload);
  await put(discovery.paths.entry,discovery.entry);
  // Publish completion only after all required objects were acknowledged.
  const completed=await put(discovery.paths.completion,discovery.completion);
  return {objectName:name,objectVersion:stored.fileId,payloadDigest:row.payload_digest,capturedAt:new Date(stored.uploadTimestamp).toISOString(),discoverySequence:row.discovery_sequence,discoveryName:discovery.paths.completion,discoveryVersion:completed.fileId,discoveryDigest:digest(discovery.completion)};
 }};
}
