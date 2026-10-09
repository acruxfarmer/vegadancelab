// Isolated Development ingestion tooling; ordinary playback remains untouched.
import {scaleEngineAssetScope} from '../src/runtime/providers/scaleengine-asset-scope.mjs';
export function paidFixtureUploadAdapter({cdnId,apiSecret},fetcher=fetch){
 if(!/^\d+$/.test(cdnId)||typeof apiSecret!=='string'||!apiSecret||apiSecret.trim()!==apiSecret)throw Error('private-configuration');
 const headers={Authorization:'Basic '+Buffer.from(cdnId+':'+apiSecret).toString('base64')};
 const base='https://acruxanalog-sestore.secdn.net/v1';
 const assetRef=id=>{if(!/^[0-9a-f-]{36}$/.test(id))throw Error('binding-identity');return '/acrux-l6-s8b-'+id+'.mp4';};
 async function request(path,options={},missing=false){
  const r=await fetcher(base+path,{...options,headers,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(missing&&r.status===404)return null;
  if(!r.ok)throw Error('provider-http');
  const b=await r.json();if(b.error||(b.errors&&(!Array.isArray(b.errors)||b.errors.length))||!b.data||Array.isArray(b.data)||typeof b.data!=='object')throw Error('provider-shape');
  return b.data;
 }
 function identity(f,path,size){
  if(f.name!==path.slice(1)||!['/'+f.name,f.name].includes(f.path)||!['.','/',''].includes(f.parent)||f.type!=='file'||!Number.isSafeInteger(Number(f.size))||Number(f.size)<=0||size!==undefined&&Number(f.size)!==size)throw Error('file-identity');
 }
 return {provider:'scaleengine',integrationRef:'development-media',assetRef,
  async upload(id,bytes){
   const path=assetRef(id);
   if(await request('/files'+path,{},true)!==null)throw Error('destination-exists');
   const form=new FormData();form.append('filename[]',new Blob([bytes],{type:'video/mp4'}),path.slice(1));
   const f=await request('/upload'+path,{method:'POST',body:form});identity(f,path,bytes.length);
   return {assetRef:path};
  },
  async inspect(id){
   const path=assetRef(id),f=await request('/files'+path+'?option:metadata=true',{},true);
   if(!f)return {state:'missing'};identity(f,path,3578);
   const m=f.metadata;
   if(String(m?.deleted)==='1'||String(m?.invalid)==='1')return {state:'failed',assetRef:path};
   if(String(m?.deleted)!=='0'||String(m?.invalid)!=='0'||m?.video_codec!=='h264'||!(Number(m?.duration)>0)||!f.vod_url)return {state:'processing',assetRef:path};
   const binding={provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:path,playbackRef:f.vod_url};
   scaleEngineAssetScope(binding);
   return {state:'ready',assetRef:path,playbackRef:f.vod_url};
  }
 };
}
