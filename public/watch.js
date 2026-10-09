import {rentalTerms,rentalStatus} from './rental-ui.js';
import {createSession} from './session.js';
import {mediaPresentation,accessNotice} from './media-access.js';
import {mountAcruxPlayer} from './acrux-player.js';
const root=document.querySelector('#watch'),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0,player;
let rentalSession=null,rentalStorageKey=null;
const saveRental=()=>{try{if(rentalStorageKey){if(rentalSession)localStorage.setItem(rentalStorageKey,JSON.stringify(rentalSession));else localStorage.removeItem(rentalStorageKey);}}catch{}};
async function rentalRequest(action,body={}){const token=await session.access();const response=await fetch('/api/media/placements/'+encodeURIComponent(id)+'/rental/'+action,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),...body}),cache:'no-store',signal:AbortSignal.timeout(20000)});const result=await response.json();if(!response.ok)throw Error('Rental playback is currently unavailable.');return result;}

function clear(){generation++;player?.destroy();player=null;root.innerHTML='<p role="status">Checking access…</p>';}
const session=createSession({storage:sessionStorage,onPending:clear,onLost:()=>load(),onReady:()=>load()});
const id=new URL(location.href).searchParams.get('placement');
const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
async function request(suffix=''){const token=session.active()?await session.access():null;const response=await fetch('/api/media/placements/'+encodeURIComponent(id)+suffix,{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store',signal:AbortSignal.timeout(20000)});if(token&&response.status===401){session.clear();throw Error('Session expired');}return response;}
async function load(){
 clear();const current=generation;
 try{
  if(!valid)throw Error();const response=await request();if(!response.ok)throw Error();const result=await response.json();if(current!==generation)return;
  const m=result.metadata,p=mediaPresentation(result.decision);
  const rental=typeof result.rental==='object'?result.rental:typeof result.decision.rental==='object'?result.decision.rental:null;
  rentalStorageKey=rental?.entitlementId?'acrux-rental:'+rental.entitlementId:null;rentalSession=null;try{if(rentalStorageKey)rentalSession=JSON.parse(localStorage.getItem(rentalStorageKey)||'null');}catch{}
  const offer=result.decision.reason==='paid_access_required'?result.offer:null;
  root.innerHTML='<a href="/member.html#library">Media Library / sign in</a><section class="card">'+(m?'<h1>'+escape(m.title)+'</h1><p>'+escape(m.description)+'</p><p>'+escape(m.creator)+'</p>':'<h1>Media unavailable</h1>')+accessNotice(result.decision,escape,[{state:'sign_in_required',href:'/member.html#library',label:'Sign in'}])+rentalStatus(result.rental&&typeof result.decision.rental!=='object'?result.rental:null,escape)+(offer?rentalTerms(offer.rentalPolicy,escape):'')+(p.playable?'<div data-acrux-player></div>':'')+'</section>';
  if(offer){const link=document.createElement('a');link.className='button';link.href='/member.html?offer='+encodeURIComponent(offer.id)+'#passes';link.textContent='Buy access · '+new Intl.NumberFormat('en-US',{style:'currency',currency:offer.currency}).format(offer.priceMinor/100);root.querySelector('section').append(link);}
  if(p.playable)player=mountAcruxPlayer(root.querySelector('[data-acrux-player]'),{title:m?.title,poster:m?.poster,onPlaybackProgress:({position})=>{if(rentalSession){rentalSession.position=position;saveRental();}},onPlaybackEvent:async({event,rental})=>{const result=await rentalRequest(event,{sessionId:rental.sessionId,attemptId:rental.attemptId});if(result.recovered===true){rentalSession=null;saveRental();}if(result.rental){Object.assign(rental,result.rental);rentalSession={...result.rental,position:rentalSession?.position||0};saveRental();}if(event==='finish'){rentalSession=null;saveRental();}return result;},getSequence:async()=>{if(rentalSession?.sessionId&&(result.rental||result.decision.rental))return {revision:0,stages:['PRIMARY']};const r=await request('/sequence');if(!r.ok||current!==generation)throw Error();return r.json();},getSource:async({stage,revision})=>{
   if(stage==='PRIMARY'&&(result.rental||result.decision.rental)){let grant;do{grant=await rentalRequest('start',rentalSession?.sessionId?{sessionId:rentalSession.sessionId}:{});if(grant.recovered){rentalSession=null;saveRental();await new Promise(resolve=>setTimeout(resolve,5000));if(current!==generation)throw Error('Viewing page changed');}}while(grant.recovered);if(!grant.source)throw Error('Playback needs an access adjustment');const resumePosition=rentalSession?.position||0;rentalSession={...grant.rental,position:resumePosition};saveRental();return {...grant.source,rental:grant.rental,resumePosition};}
   const r=await request('/sequence/'+encodeURIComponent(stage)+'/'+revision);if(current!==generation)throw Error();
   if(!r.ok){await load();throw Error();}
   return r.headers.get('content-type')?.includes('application/json')?r.json():{kind:'mp4',blob:await r.blob()};
  }});
 }catch{if(current===generation)root.innerHTML='<h1>Media unavailable</h1><p role="status">Access could not be checked. Please try again.</p><a href="/member.html#library">Media Library</a>';}
}
session.restore();load();addEventListener('pagehide',clear);
