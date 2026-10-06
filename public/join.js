import {createSession} from './session.js';
import {customerProfileUI} from './customer-profile-ui.js';
import {createRequestJournal} from './request-journal.js';
const e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const params=new URLSearchParams(location.search),studio=params.get('studio')||'vega',classId=params.get('class');
const main=document.querySelector('main');let business=null,data=null,publicData=null,mode=params.get('mode')==='signin'?'signin':'signup',busy=false;
const journal=createRequestJournal(sessionStorage);
const session=createSession({storage:sessionStorage,onPending:()=>{main.textContent='Checking your session…';document.querySelector('#dialog').close();},onReady:()=>{void (business?loadProfile():Promise.resolve(setup())).catch(error=>message(error.message));},onLost:()=>{business=null;data=null;document.querySelector('#dialog').close();document.querySelector('#dialog-body').replaceChildren();document.querySelector('#sign-out').classList.add('hidden');auth();}});
function message(text){let box=document.querySelector('#message');if(!box){box=document.createElement('p');box.id='message';box.setAttribute('role','status');main.prepend(box);}box.textContent=text;}
async function api(path,body,protectedRequest=true){const generation=session.generation();const token=protectedRequest?await session.access():null;const response=await fetch(path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(business?{'X-Vega-Tenant':business.tenantId,'X-Vega-Business':business.businessId}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(25000)});if(protectedRequest&&generation!==session.generation())throw Error('Session changed. Please sign in again.');const value=await response.json();if(!response.ok)throw Error(value.error||'Please try again.');return value;}
function auth(){main.innerHTML=`<p class="eyebrow">${e(publicData?.studio.name||'Your studio')}</p><h1>${mode==='signup'?'Your next chapter starts here.':'Welcome back.'}</h1><p class="lead">${mode==='signup'?'Create your account, then set up your relationship with this studio.':'Sign in to continue to your studio.'}</p>${classId?'<p class="notice">Your class selection is saved while you continue. A place is only reserved after booking confirmation.</p>':''}<form id="auth"><label class="field">Email<input name="email" type="email" autocomplete="username" maxlength="254" required></label><label class="field">Password<input name="password" type="password" autocomplete="${mode==='signup'?'new-password':'current-password'}" ${mode==='signup'?'minlength="12"':''} maxlength="1024" required></label>${mode==='signup'?'<p class="meta">Use at least 12 characters. You may need to confirm your email.</p>':''}<p role="alert" class="error"></p><button class="button">${mode==='signup'?'Create account':'Sign in'}</button></form><p><button class="button secondary" id="switch-mode">${mode==='signup'?'Already have an account? Sign in':'New here? Create an account'}</button></p>`;}
function setup(){document.querySelector('#sign-out').classList.remove('hidden');main.innerHTML=`<p class="eyebrow">Your studio relationship</p><h1>Let’s get acquainted.</h1><p class="lead">Continue as yourself at ${e(publicData.studio.name)}. If you already have a member relationship here, we’ll use it.</p><form id="setup"><label class="field">Your full name<input name="displayName" autocomplete="name" maxlength="120" required></label><p class="meta">If we find a possible existing customer record, the studio will need to review the relationship before you continue.</p><p role="alert" class="error"></p><button class="button">Continue to my profile</button></form>`;}
const profile=customerProfileUI({getData:()=>data,escape:e,notify:message,modal:html=>{document.querySelector('#dialog-body').innerHTML=html;document.querySelector('#dialog').showModal();},mutate:async(path,body)=>{
 const context=data.context,pending=await journal.acquire([context.tenantId,context.businessId,context.userId],path,body);
 let result=await api(path,{...body,requestId:pending.requestId});
 for(let i=0;result.pending&&i<8;i++){await new Promise(r=>setTimeout(r,750));result=await api('/api/recovery/operations/'+result.independentReceipt.operationId);}
 if(result.pending)throw Error('Your record is saved and awaiting recovery confirmation. Refresh to check its status.');
 await journal.complete(pending);await loadProfile();
}});
async function loadProfile(){data=await api('/api/app');if(data.context.role==='staff'){main.innerHTML='<h1>Welcome back.</h1><p>Your existing studio staff access is unchanged.</p>'+nextLink('Open studio workspace');return;}main.innerHTML=profile.member();const p=data.customerProfile,ready=p?.status==='ready'&&p.revision>0&&p.waiverStatus!=='Acceptance required';main.insertAdjacentHTML('beforeend',`<section><h2>Your next class</h2>${ready?nextLink(classId?'Continue to selected class':'Explore member classes'):'<p>Complete your profile and review the current waiver above before continuing.</p>'}<p class="meta">Your account checks current availability and any required pass. No booking or payment has been made.</p><p id="message" role="status"></p></section>`);}
function nextLink(label){return `<a class="button" href="/member.html?${e(new URLSearchParams({tenant:business.tenantId,business:business.businessId,...(classId?{class:classId}:{})}).toString())}#classes">${e(label)} ↗</a>`;}
document.addEventListener('click',async event=>{if(event.target.id==='switch-mode'){mode=mode==='signup'?'signin':'signup';auth();}if(event.target.matches('[data-refresh-booking]')){try{await loadProfile();}catch(error){message(error.message);}}if(event.target.id==='sign-out'){try{await session.signOut();}catch(error){message(error.message);}}});
document.addEventListener('submit',async event=>{const form=event.target;if(form.id.startsWith('customer-')){event.preventDefault();await profile.submit(form);return;}if(!['auth','setup'].includes(form.id))return;event.preventDefault();if(busy)return;busy=true;const button=form.querySelector('button');button.disabled=true;try{
 const fields=Object.fromEntries(new FormData(form));
 if(form.id==='auth'){
  const value=await api('/api/auth/'+(mode==='signup'?'sign-up':'sign-in'),{...fields,...(mode==='signup'?{studio,...(classId?{classId}: {})}:{})},false);
  if(value.verificationRequired){mode='signin';auth();message(value.message);return;}
  session.accept(value);setup();
 }else{
  const result=await api('/api/onboarding',{studio,displayName:fields.displayName});
  if(result.status==='needs_staff_review'){main.innerHTML='<h1>Needs Staff Review</h1><p class="lead">We could not establish one unambiguous relationship with this studio. Please contact the studio before continuing. No existing customer record has been claimed.</p>';return;}
  if(result.status==='verification_required')throw Error('Confirm your email before continuing. Then sign out and sign back in.');
  if(!['ready','existing_staff'].includes(result.status))throw Error('Account setup is not currently available for this studio.');
  business={tenantId:result.tenantId,businessId:result.businessId};
  if(result.independentReceipt&&result.independentReceipt.state!=='acknowledged'){
   let receipt={pending:true};for(let i=0;receipt.pending&&i<8;i++){await new Promise(r=>setTimeout(r,750));receipt=await api('/api/recovery/operations/'+result.independentReceipt.operationId);}
   if(receipt.pending)throw Error('Your studio relationship is saved and awaiting recovery confirmation. Continue again to check; a duplicate will not be created.');
  }
  await loadProfile();
 }
 }catch(error){const target=form.querySelector('[role="alert"]');if(form.isConnected&&target)target.textContent=error.message;else message(error.message);}finally{busy=false;button.disabled=false;}});
async function start(){try{
 publicData=await api('/api/public/studios/'+encodeURIComponent(studio),null,false);document.querySelector('#brand').textContent=publicData.studio.name;document.querySelector('#brand').href=document.querySelector('#back').href='/?'+new URLSearchParams({studio,...(classId?{class:classId}:{})});
 const callback=new URLSearchParams(location.hash.slice(1));
 if(callback.has('access_token')){history.replaceState(null,'',location.pathname+location.search);session.accept({accessToken:callback.get('access_token'),refreshToken:callback.get('refresh_token'),expiresIn:Number(callback.get('expires_in'))});await session.access();setup();}
 else if(callback.has('error')){history.replaceState(null,'',location.pathname+location.search);auth();message('The confirmation link could not be completed. Try signing in or request a new account confirmation.');}
 else if(session.restore()){await session.refresh();setup();}else auth();
 }catch(error){main.innerHTML='<h1>Unable to continue</h1><p role="alert">'+e(error.message)+'</p><a href="'+e(location.pathname+location.search)+'">Try again</a>';}}
void start();
