import {randomBytes} from 'node:crypto';
import {requireReadyMediaBinding} from '../../media-provider-binding.mjs';
import {scaleEngineAssetScope} from './scaleengine-asset-scope.mjs';
const fail=category=>{const e=new Error('Playlist inspection stopped');e.safeCategory=category;throw e;};

export function playlistReferenceStructure(master,child,logicalAsset,secrets=[]){
 const base=new URL(master),resolved=new URL(child,base);
 const prefix=base.pathname.slice(0,base.pathname.lastIndexOf('/')+1);
 const clean=value=>{
  let s=value;
  for(const secret of secrets.filter(v=>typeof v==='string'&&v.length)){
   for(const encoded of [secret,encodeURIComponent(secret),Buffer.from(secret).toString('base64')])s=s.split(encoded).join('<redacted>');
  }
  return s;
 };
 // Preserve the literal reference up to its query/fragment; never retain their values.
 const literal=child.split(/[?#]/,1)[0].replace(/(\/\/)[^/]*@/,'$1<redacted>@');
 const reasons=[];
 if(resolved.origin!==base.origin)reasons.push('origin-changed');
 if(!resolved.pathname.startsWith(prefix))reasons.push('pathname-outside-master-directory');
 if(resolved.username||resolved.password)reasons.push('userinfo-present');
 if(resolved.hash)reasons.push('fragment-present');
 if(resolved.search)reasons.push('query-present');
 if(/%|\\/.test(resolved.pathname))reasons.push('encoded-or-backslash-path');
 const sameDirectory=resolved.origin===base.origin&&resolved.pathname.startsWith(prefix);
 return {
  masterOrigin:clean(base.origin),masterPathname:clean(base.pathname),
  childReferenceWithoutQueryOrFragment:clean(literal),queryStripped:child.includes('?'),fragmentStripped:child.includes('#'),
  referenceKind:/^[A-Za-z][A-Za-z0-9+.-]*:/.test(child)?'absolute':child.startsWith('//')?'network-relative':child.startsWith('/')?'root-relative':'relative',
  resolvedChildOrigin:clean(resolved.origin),resolvedChildPathname:clean(resolved.pathname),originChanges:resolved.origin!==base.origin,
  sameLogicalAsset:sameDirectory&&!/%|\\/.test(resolved.pathname)?true:null,
  logicalAssetPathPresent:resolved.pathname.includes('/'+logicalAsset+'/'),
  assetInterpretation:sameDirectory?'same persisted asset directory':'unproven; namespace requires review',
  currentGuardRejects:reasons.length>0,currentGuardReasons:reasons,childFollowed:false
 };
}

export function playlistQueryNames(master,child,secrets=[]){
 const names=[...new URL(child,master).searchParams.keys()];
 // A malformed provider could place secret material in a parameter name.
 // Stop without emitting that name rather than treating it as safe metadata.
 if(names.length>32||names.some(n=>!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(n)||secrets.some(s=>typeof s==='string'&&s.length&&n.includes(s))))fail('query-name-not-safe-to-record');
 const unique=[...new Set(names)];
 return {parameterNames:unique,parameterCount:names.length,duplicateNamesPresent:unique.length!==names.length,duplicateParameterNames:unique.filter(n=>names.filter(v=>v===n).length>1)};
}

export async function inspectScaleEnginePlaylist({environment,cdnId,apiSecret,resource,binding,capture='structure',observe=async()=>{}},fetcher=fetch){
 if(!['structure','query-names'].includes(capture))fail('inspection-mode-invalid');
 if(environment!=='development'||!/^\d+$/.test(cdnId)||typeof apiSecret!=='string'||!apiSecret||apiSecret.trim()!==apiSecret)fail('development-configuration-required');
 requireReadyMediaBinding(resource,binding);const scope=scaleEngineAssetScope(binding);
 const auth='Basic '+Buffer.from(cdnId+':'+apiSecret,'utf8').toString('base64');
 const api='https://api.scaleengine.net/v2/sevu_token';
 const pass=randomBytes(24).toString('hex'),expiresAt=new Date(Date.now()+120000).toISOString();
 let ticket,attempted=false;
 async function request(url,options={}){try{return await fetcher(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{fail('transport-failure-no-retry');}}
 async function bytes(r){const chunks=[];let n=0;for await(const c of r.body){n+=c.length;if(n>2*1024*1024)fail('response-bound-exceeded');chunks.push(c);}return Buffer.concat(chunks);}
 try{
  await observe({stage:'ticket-create',ticketAttempts:1,app:scope.app,video:scope.video,ip:'auto',uses:5,expiresAt,cleanupPending:true});attempted=true;
  const created=await request(api,{method:'PUT',headers:{Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify({app:scope.app,video:scope.video,pass,ip:'auto',uses:5,active:true,expire_date:expiresAt.replace('T',' ').slice(0,19)})});
  await observe({stage:'ticket-response',httpStatus:created.status});
  if(!created.ok){await created.body?.cancel();fail('ticket-create-http-failure');}
  let body;try{body=JSON.parse((await bytes(created)).toString('utf8'));}catch{fail('ticket-response-invalid');}
  ticket=body?.data;
  const rawExpiry=ticket?.expire_date,expiry=typeof rawExpiry==='string'?Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(rawExpiry)?rawExpiry.replace(' ','T')+'Z':rawExpiry):NaN;
  if(body.error||(body.errors&&(!Array.isArray(body.errors)||body.errors.length))||typeof ticket?.key!=='string'||!ticket.key.trim()||typeof ticket.pass!=='string'||!ticket.pass.trim()||ticket.app!==scope.app||ticket.video!==scope.video||![true,1,'1'].includes(ticket.active)||!(expiry>Date.now()))fail('returned-ticket-invariants-failed');
  const u=new URL(scope.playbackRef);u.searchParams.set('key',ticket.key);u.searchParams.set('pass',ticket.pass);
  const r=await request(u.href);await observe({stage:'master-playlist',httpStatus:r.status,playbackRequests:1});
  if(r.status!==200){await r.body?.cancel();fail('master-playlist-http-failure');}
  const text=(await bytes(r)).toString('utf8');if(!text.trimStart().startsWith('#EXTM3U'))fail('hls-playlist-not-returned');
  const child=text.split(/\r?\n/).map(x=>x.trim()).find(x=>x&&!x.startsWith('#'));if(!child)fail('child-reference-missing');
  const secrets=[ticket.key,ticket.pass,pass,cdnId,apiSecret,auth];
  if(capture==='query-names'){
   await observe({stage:'child-query-names-captured',...playlistQueryNames(scope.playbackRef,child,secrets)});
   return {queryNamesCaptured:true,childFollowed:false,playbackRequests:1};
  }
  const structure=playlistReferenceStructure(scope.playbackRef,child,scope.video,secrets);
  await observe({stage:'child-structure-captured',...structure});
  return {structureCaptured:true,childFollowed:false,playbackRequests:1};
 }finally{
  if(typeof ticket?.key==='string'&&ticket.key){
   try{const r=await request(api+'/'+encodeURIComponent(ticket.key),{method:'DELETE',headers:{Authorization:auth}});await r.body?.cancel();const removed=r.ok||r.status===404;await observe({stage:'ticket-cleanup',httpStatus:r.status,ticketRemoved:removed,cleanupPending:!removed});if(!removed)fail('ticket-cleanup-unconfirmed');}
   catch{await observe({stage:'ticket-cleanup',cleanupPending:true});fail('ticket-cleanup-unconfirmed');}
  }else if(attempted)await observe({stage:'ticket-cleanup',cleanupPending:true,shortExpirationRequested:true});
 }
}
