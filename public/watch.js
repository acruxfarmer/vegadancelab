import {createSession} from './session.js';
import {mediaPresentation,accessNotice} from './media-access.js';
const root=document.querySelector('#watch'),escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let objectUrl,generation=0;
function clear(){generation++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;root.innerHTML='<p role="status">Checking access…</p>';}
const session=createSession({storage:sessionStorage,onPending:clear,onLost:()=>load(),onReady:()=>load()});
const id=new URL(location.href).searchParams.get('placement');
const valid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id||'');
async function request(play=false){const token=session.active()?await session.access():null;const response=await fetch('/api/media/placements/'+encodeURIComponent(id)+(play?'/play':''),{headers:token?{Authorization:'Bearer '+token}:{},cache:'no-store',signal:AbortSignal.timeout(20000)});if(token&&response.status===401){session.clear();throw Error('Session expired');}return response;}
async function load(){
 clear();const current=generation;
 try{
  if(!valid)throw Error();const response=await request();if(!response.ok)throw Error();const result=await response.json();if(current!==generation)return;
  const m=result.metadata,p=mediaPresentation(result.decision);
  root.innerHTML='<a href="/member.html#library">Media Library / sign in</a><section class="card">'+(m?'<h1>'+escape(m.title)+'</h1><p>'+escape(m.description)+'</p><p>'+escape(m.creator)+'</p>':'<h1>Media unavailable</h1>')+accessNotice(result.decision,escape,[{state:'sign_in_required',href:'/member.html#library',label:'Sign in'}])+(p.playable?'<video controls playsinline preload="none" poster="/media-poster.svg" aria-label="'+escape(m?.title||'Video')+'" style="width:100%;max-height:65vh"></video><button class="button" id="play">Play video</button>':'')+'</section>';
  root.querySelector('#play')?.addEventListener('click',async e=>{e.target.disabled=true;try{const r=await request(true);if(!r.ok){await load();return;}const blob=await r.blob();if(current!==generation)return;objectUrl=URL.createObjectURL(blob);const v=root.querySelector('video');v.src=objectUrl;await v.play();}catch{if(current===generation)root.querySelector('[role="status"]').textContent='This video is currently unavailable.';}finally{e.target.disabled=false;}});
 }catch{if(current===generation)root.innerHTML='<h1>Media unavailable</h1><p role="status">Access could not be checked. Please try again.</p><a href="/member.html#library">Media Library</a>';}
}
session.restore();load();addEventListener('pagehide',clear);
