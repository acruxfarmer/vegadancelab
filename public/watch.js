import {createSession} from './session.js';
import {mediaPresentation,accessNotice} from './media-access.js';
import {mountAcruxPlayer} from './acrux-player.js';
const root=document.querySelector('#watch'),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let generation=0,player;
function clear(){generation++;player?.destroy();player=null;root.innerHTML='<p role="status">Checking access…</p>';}
const session=createSession({storage:sessionStorage,onPending:clear,onLost:()=>load(),onReady:()=>load()});
const id=new URL(location.href).searchParams.get('placement');
const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
async function request(play=false){const token=session.active()?await session.access():null;const response=await fetch('/api/media/placements/'+encodeURIComponent(id)+(play?'/play':''),{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store',signal:AbortSignal.timeout(20000)});if(token&&response.status===401){session.clear();throw Error('Session expired');}return response;}
async function load(){
 clear();const current=generation;
 try{
  if(!valid)throw Error();const response=await request();if(!response.ok)throw Error();const result=await response.json();if(current!==generation)return;
  const m=result.metadata,p=mediaPresentation(result.decision);
  root.innerHTML='<a href="/member.html#library">Media Library / sign in</a><section class="card">'+(m?'<h1>'+escape(m.title)+'</h1><p>'+escape(m.description)+'</p><p>'+escape(m.creator)+'</p>':'<h1>Media unavailable</h1>')+accessNotice(result.decision,escape,[{state:'sign_in_required',href:'/member.html#library',label:'Sign in'}])+(p.playable?'<div data-acrux-player></div>':'')+'</section>';
  if(p.playable)player=mountAcruxPlayer(root.querySelector('[data-acrux-player]'),{title:m?.title,poster:m?.poster,getSource:async()=>{
   const r=await request(true);if(current!==generation)throw Error();
   if(!r.ok){await load();throw Error();}
   return r.headers.get('content-type')?.includes('application/json')?r.json():{kind:'mp4',blob:await r.blob()};
  }});
 }catch{if(current===generation)root.innerHTML='<h1>Media unavailable</h1><p role="status">Access could not be checked. Please try again.</p><a href="/member.html#library">Media Library</a>';}
}
session.restore();load();addEventListener('pagehide',clear);
