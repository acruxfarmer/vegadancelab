import {createSession} from './session.js';
const root=document.querySelector('#connections'),notice=document.querySelector('#notice');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let businesses=[],business=null,records={},busy=false,loading=false,loadGeneration=0;
const controls=()=>root.querySelectorAll('button,select').forEach(control=>control.disabled=busy||loading);
const session=createSession({storage:sessionStorage,onLost:()=>{loadGeneration++;businesses=[];business=null;records={};loading=false;root.innerHTML='<p><a href="/manage-media.html">Sign in through media management</a>, then return here.</p>';},onReady:()=>load()});
async function request(path,body,scope=business){
 const response=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+await session.access(),...(scope?{'x-vega-tenant':scope.tenantId,'x-vega-business':scope.businessId}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(35000)});
 const value=await response.json();if(!response.ok)throw Error(value.error||'Connection request could not be completed.');return value;
}
function render(){
 root.innerHTML=`<label class="field">Business<select id="business">${businesses.map((b,i)=>`<option value="${i}" ${b===business?'selected':''}>${esc(b.name)}</option>`).join('')}</select></label>`+Object.entries(records).map(([provider,r])=>`<section class="card"><h2>${provider==='vimeo'?'Vimeo':'YouTube'}</h2><p>${esc(r.error||r.status?.replaceAll('_',' '))}</p>${r.accountName?`<p>Account: ${esc(r.accountName)} (${esc(r.accountId)})</p>`:''}${r.scopes?.length?`<p>Read permissions: ${esc(r.scopes.join(', '))}</p>`:''}${r.verifiedAt?`<p>Last verified: ${esc(new Date(r.verifiedAt).toLocaleString())}. Bounded sample: ${r.sampleCount} item(s). No media imported.</p>`:''}${r.revocation&&r.revocation!=='confirmed'&&r.revocation!=='not_required'?'<p>Provider revocation is not confirmed. Acrux access is disconnected; review the authorization in your provider account.</p>':''}${r.configured?(r.status==='disconnected'?`<button data-provider="${provider}" data-action="begin">Connect account</button>`:`${['connected','unavailable','reconnect_required'].includes(r.status)?`<button data-provider="${provider}" data-action="verify">Check connection</button>`:''}<button data-provider="${provider}" data-action="disconnect">Disconnect</button><p>To reconnect or change account, disconnect first, then connect again.</p>`):'<p>Development provider setup is pending.</p>'}</section>`).join('');
 root.querySelector('#business')?.addEventListener('change',event=>{if(busy||loading)return;business=businesses[Number(event.target.value)];load();});
 controls();
}
async function load(){
 const generation=++loadGeneration;loading=true;controls();
 try{
  if(!businesses.length){const result=await request('/api/businesses',undefined,null);if(generation!==loadGeneration)return;businesses=result.businesses;business=businesses[0];}
  if(!business){root.innerHTML='<p>No authorized business is available.</p>';return;}
  const scope=business,next={};
  for(const provider of ['vimeo','youtube']){try{next[provider]=await request('/api/media-connections/'+provider,undefined,scope);}catch(error){next[provider]={error:error.message};}if(generation!==loadGeneration)return;}
  records=next;
  render();
 }catch(error){if(generation===loadGeneration)notice.textContent=error.message;}
 finally{if(generation===loadGeneration){loading=false;controls();}}
}
root.addEventListener('click',async event=>{
 const button=event.target.closest('button[data-action]');if(!button||busy||loading)return;
 busy=true;root.querySelectorAll('button,select').forEach(control=>control.disabled=true);notice.textContent='Working…';
 try{
  const provider=button.dataset.provider,result=await request('/api/media-connections/'+provider+'/'+button.dataset.action,{expectedRevision:records[provider].revision});
  if(result.authorizationUrl){const url=new URL(result.authorizationUrl);if(url.origin!=='https://api.vimeo.com'&&url.origin!=='https://accounts.google.com')throw Error('Invalid provider authorization destination.');location.assign(url.href);return;}
  notice.textContent=result.status==='disconnected'?'Disconnected from Acrux.':'Connection check finished.';await load();
 }catch(error){notice.textContent=error.message;await load();}finally{busy=false;controls();}
});
if(location.hash){notice.textContent=location.hash==='#connected'?'Account connected.':'Authorization did not complete. Check the connection status before reconnecting.';history.replaceState(null,'',location.pathname);}
if(session.restore())load();
