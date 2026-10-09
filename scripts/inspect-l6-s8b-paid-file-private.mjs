import fs from 'node:fs/promises';
const dir=new URL('../docs/layer-6/',import.meta.url);
const name='acrux-l6-s8b-774b5968-16fb-427b-a3c6-16ffe431fa5d.mp4';
const report={status:'preflight',method:'GET',assetRef:'/'+name,requests:0,uploads:0,bindingMutations:0,productionUntouched:true};
let acquired=false;
try{
 let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>32768)throw Error();}
 const input=JSON.parse(raw.replace(/^\uFEFF/,''));raw='';
 if(!/^\d+$/.test(input.cdnId)||typeof input.apiSecret!=='string'||!input.apiSecret||input.apiSecret.trim()!==input.apiSecret)throw Error();
 await fs.writeFile(new URL('l6-s8b-paid-file-inspection-attempted.local.json',dir),JSON.stringify({assetRef:report.assetRef}),{flag:'wx'});acquired=true;
 report.requests=1;
 const r=await fetch('https://acruxanalog-sestore.secdn.net/v1/files/'+name+'?option:metadata=true',{headers:{Authorization:'Basic '+Buffer.from(input.cdnId+':'+input.apiSecret).toString('base64')},redirect:'error',signal:AbortSignal.timeout(60000)});
 report.httpStatus=r.status;
 if(r.status===404){report.status='exact-file-not-found';}
 else if(!r.ok){report.status='provider-http-rejection';}
 else{
  const body=await r.json(),f=body.data;
  report.topLevelType=Array.isArray(body)?'array':typeof body;
  report.dataType=Array.isArray(f)?'array':typeof f;
  report.hasProviderError=!!body.error||!!(body.errors&&(!Array.isArray(body.errors)||body.errors.length));
  report.identity={nameMatches:f?.name===name,pathMatches:[name,'/'+name].includes(f?.path),parentRoot:['.','/',''].includes(f?.parent),typeFile:f?.type==='file',sizeMatches:Number(f?.size)===3578};
  report.metadata={present:!!f?.metadata,notDeleted:String(f?.metadata?.deleted)==='0',notInvalid:String(f?.metadata?.invalid)==='0',h264:f?.metadata?.video_codec==='h264',positiveDuration:Number(f?.metadata?.duration)>0};
  report.playbackMappingMatches=false;
  if(typeof f?.vod_url==='string'){
   const {scaleEngineAssetScope}=await import('../src/runtime/providers/scaleengine-asset-scope.mjs');
   try{const scope=scaleEngineAssetScope({provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/'+name,playbackRef:f.vod_url});report.playbackMappingMatches=true;report.logicalVideo=scope.video;}catch{}
  }
  report.status='exact-file-evidence-captured';
 }
}catch{report.status='inspection-stopped';}
finally{
 if(acquired)await fs.writeFile(new URL('l6-s8b-paid-file-inspection.local.json',dir),JSON.stringify(report,null,2));
 console.log('Read-only file inspection finished. Tell Astra done; do not rerun.');
}
