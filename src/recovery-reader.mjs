// Offline operator only. No database, writer, listing, or runtime recovery key.
const bucketId='723a5face1abcc07a4080b1f',bucketName='vega-development-backups-acrux-20260920',prefix='vega-development/';
export async function createRecoveryReader({keyId,key},fetcher=fetch){
 const options={redirect:'error',signal:AbortSignal.timeout(20000)};
 const response=await fetcher('https://api.backblazeb2.com/b2api/v4/b2_authorize_account',{...options,headers:{Authorization:'Basic '+Buffer.from(keyId+':'+key).toString('base64')}});
 if(!response.ok)throw Error('Recovery reader authorization failed');
 const auth=await response.json(),storage=auth.apiInfo?.storageApi,allowed=storage?.allowed;
 if(allowed?.buckets?.length!==1||allowed.buckets[0].id!==bucketId||allowed.namePrefix!==prefix||allowed.capabilities?.length!==1||allowed.capabilities[0]!=='readFiles')throw Error('Existing readFiles-only recovery boundary required');
 const host=new URL(storage.downloadUrl);
 if(host.protocol!=='https:'||!/^f\d+\.backblazeb2\.com$/.test(host.hostname)||host.username||host.password||host.port)throw Error('Recovery download endpoint rejected');
 return async name=>{
  if(!name.startsWith(prefix)||name.includes('..')||!/^[-a-zA-Z0-9_/.]+$/.test(name))throw Error('Recovery object scope rejected');
  const r=await fetcher(`${host.origin}/file/${bucketName}/${name.split('/').map(encodeURIComponent).join('/')}`,{redirect:'error',signal:AbortSignal.timeout(20000),headers:{Authorization:auth.authorizationToken,'Cache-Control':'no-cache'}});
  if(r.status===404){const error=await r.json();if(error.status===404&&error.code==='not_found')return null;throw Error('Unconfirmed recovery object absence');}
  if(!r.ok)throw Error('Recovery object request failed');
  if(Number(r.headers.get('Content-Length'))>50*1024*1024)throw Error('Recovery object exceeds bounded reader');
  const chunks=[];let size=0;
  for await(const chunk of r.body){size+=chunk.length;if(size>50*1024*1024)throw Error('Recovery object exceeds bounded reader');chunks.push(chunk);}
  return Buffer.concat(chunks);
 };
}
