import {mountExternalMedia} from './external-media-player.js';
export function externalMediaManagement({host,getData,session,escape,changed}){
 let generation=0,busy=false,scope=null,provider='vimeo',page='',result=null,player=null;
 const clear=()=>{generation++;player?.destroy();player=null;result=null;host.replaceChildren();};
 async function request(path,body,business){
  const token=await session.access();
  const response=await fetch(path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','x-vega-tenant':business.tenantId,'x-vega-business':business.businessId},body:JSON.stringify(body),cache:'no-store',signal:AbortSignal.timeout(45000)});
  if(response.status===401){session.clear();throw Error('Sign in again.');}
  const data=await response.json();if(!response.ok)throw Error(data.error||'External media unavailable');return data;
 }
 function render(message=''){
  const businesses=getData()?.businesses||[];
  host.innerHTML=`<section class="card"><h2>Add from a connected source</h2><p>Only your selected references enter this business library. New placements remain hidden.</p><label>Business<select data-source-business>${businesses.map((b,i)=>`<option value="${i}" ${scope===i?'selected':''}>${escape(b.businessId)}</option>`).join('')}</select></label><label>Source<select data-source-provider><option value="vimeo" ${provider==='vimeo'?'selected':''}>Vimeo</option><option value="youtube" ${provider==='youtube'?'selected':''}>YouTube</option></select></label><button data-discover>Browse connected account</button><p>Read-only discovery. <a href="/media-connections.html">Manage connections</a>. Source restrictions can prevent preview or viewing.</p><p role="status">${escape(message)}</p><div>${(result?.items||[]).map(item=>`<article><h3>${escape(item.title)}</h3><p>${escape(item.provider)} · ${escape(item.id)} · ${escape(item.status)}${item.registered?' · Already registered':''}</p><button data-register="${escape(item.id)}" ${!item.eligible||item.registered?'disabled':''}>Add reference — hidden</button></article>`).join('')}${result&&!result.items.length?'<p>No media on this page.</p>':''}</div>${result?.nextPage?'<button data-source-next>Next page</button>':''}</section>`;
  host.querySelectorAll('button,select').forEach(el=>{if(busy)el.disabled=true;});
 }
 host.addEventListener('change',e=>{if(e.target.matches('[data-source-business],[data-source-provider]')){generation++;scope=Number(host.querySelector('[data-source-business]').value);provider=host.querySelector('[data-source-provider]').value;page='';result=null;render();}});
 host.addEventListener('click',async e=>{
  const button=e.target.closest('button');if(!button||busy)return;
  scope=Number(host.querySelector('[data-source-business]')?.value);const business=getData()?.businesses?.[scope];if(!business)return;
  const current=++generation,selectedProvider=provider;busy=true;
  try{
   if(button.hasAttribute('data-register')){await request(`/api/external-media/${selectedProvider}/register`,{id:button.dataset.register},business);if(current!==generation)return;await changed();result.items=result.items.map(x=>x.id===button.dataset.register?{...x,registered:true}:x);}
   else{page=button.hasAttribute('data-source-next')?result.nextPage:'';const found=await request(`/api/external-media/${selectedProvider}/discover`,{page},business);if(current!==generation)return;result=found;}
   busy=false;render('Current source results shown.');
  }catch(error){if(current===generation){busy=false;render(error.message);}}finally{busy=false;}
 });
 return {clear,open(){clear();scope=0;page='';render();},async resource(action,resource){
  const business=resource.owner;if(business.kind!=='business')throw Error('Business ownership required');
  const current=++generation;
  const value=await request(`/api/external-media/resources/${resource.id}/${action}`,action==='refresh'?{expectedRevision:resource.external.revision}:{},business);
  if(current!==generation)return;
  if(action==='preview'){player?.destroy();host.innerHTML='<section class="card"><h2>Private owner preview</h2><div data-preview></div></section>';player=mountExternalMedia(host.querySelector('[data-preview]'),value);}
  else{await changed();host.innerHTML='<p role="status">Source metadata refreshed. Visibility, access and organization preserved.</p>';}
 }};
}
