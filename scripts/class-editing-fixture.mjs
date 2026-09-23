// Synthetic loopback fixture using the real API, domain and projections. No providers.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {createApplicationApi} from '../src/runtime/application-api.mjs';
import {emptyState,transition,visibleState,ApplicationError} from '../src/application.mjs';
import {reviewClassEdit} from '../src/class-editing.mjs';
export function classEditingFixture(){
 const staff={role:'staff',userId:'11111111-1111-4111-8111-111111111111',tenantId:'local',businessId:'local',participantIds:[]},member={...staff,role:'member',userId:'22222222-2222-4222-8222-222222222222',participantIds:['p']};
 let state={...emptyState(),participants:[{id:'p',name:'Test Member'}]};const receipts=new Map();let revision=0;
 const actor=id=>id===staff.userId?staff:member;
 const command=(action,body)=>({action,body:{requestId:crypto.randomUUID(),...body}});
 for(const [id,title] of [['c','Schedule Editing Test'],['blocked','Cancelled Booking History']]){
  const next=transition(state,command('class',{title,instructor:'Original Teacher',location:'Studio One',capacity:10,duration:60,startsAt:'2099-10-02T12:00:00.000Z',category:'Dance',creditRequired:false,waitlistEnabled:true}),staff,{id:()=>id});state=next.state;
 }
 state.reservations.push({id:'prior',classId:'blocked',participantId:'p',status:'cancelled',attendanceStatus:'not_recorded'});
 const store={read:async id=>({context:actor(id),...visibleState(state,actor(id)),mode:'development',squareEnabled:false,revision,jobs:[]}),
  reviewClassEdit:async(id,body)=>reviewClassEdit(state,body,actor(id),new Date().toISOString(),(m,s)=>{throw new ApplicationError(m,s);}),
  command:async(id,cmd)=>{const key=id+cmd.body.requestId,signature=JSON.stringify(cmd);if(receipts.has(key)){const prior=receipts.get(key);if(prior.signature!==signature)throw new ApplicationError('Request conflict',409);return prior.result;}const next=transition(state,cmd,actor(id));state=next.state;revision++;receipts.set(key,{signature,result:next.result});return next.result;}};
 const env={VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'};
 const api=createApplicationApi(env,store,async(url,init)=>{
  if(url.includes('/token?')){const b=JSON.parse(init.body),role=b.email?.startsWith('member')||b.refresh_token==='member'?'member':'staff';return {ok:true,json:async()=>({access_token:role,refresh_token:role,expires_in:3600})};}
  return {ok:true,json:async()=>({id:init.headers.Authorization==='Bearer member'?member.userId:staff.userId})};
 });
 const assets=createDevelopmentServer(env);
 const server=createServer((req,res)=>{if(req.url.startsWith('/api/'))void api(req,res);else assets.emit('request',req,res);});
 return {server,store,staff,member,snapshot:()=>structuredClone(state)};
}
