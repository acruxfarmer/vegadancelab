// Browser verification fixture only: loopback, synthetic records, no provider IO.
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {staffRuntimeFixture,staffIds,scopes} from '../test/helpers/staff-runtime-fixture.mjs';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
const h=staffRuntimeFixture();
if(process.argv.includes('--reporting'))for(const {state} of h.records.values()){
 state.classes[0]={...state.classes[0],instructor:'Alex',startsAt:'2026-09-21T18:00:00Z',capacity:4};
 state.classes[1]={...state.classes[1],instructor:'Blair',startsAt:'2026-09-22T18:00:00Z',capacity:2};
 state.reservations[0].attendanceStatus='present';state.reservations[1].attendanceStatus='absent';
 state.classes.push({id:'empty',title:'Empty class',instructor:'Alex',startsAt:'2026-09-23T18:00:00Z',duration:60,capacity:4,status:'open'});
}
const users={owner:staffIds.owner,manager:staffIds.worker,front_desk:'44444444-4444-4444-8444-444444444444',instructor:'55555555-5555-4555-8555-555555555555',unassigned:'66666666-6666-4666-8666-666666666666',member:staffIds.member};
for(const role of ['manager','front_desk','instructor','unassigned']){
 const userId=users[role];h.memberships.set(userId,scopes.map(s=>({...s,role:'staff',participantIds:[]})));
 await h.command(userId,'staff-register',{name:role+' fixture'});
 if(role!=='unassigned')await h.command(staffIds.owner,'staff-role-set',{userId,role,classIds:role==='instructor'?['class-one']:[],expectedRevision:0});
}
const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'synthetic'},h.store,async(url,options)=>{
 if(url.includes('/token?')){const body=JSON.parse(options.body),role=body.email?.split('@')[0]||body.refresh_token;return {ok:!!users[role],status:users[role]?200:401,json:async()=>({access_token:role,refresh_token:role,expires_in:3600})};}
 const role=options.headers.Authorization?.replace('Bearer ','');return {ok:!!users[role],status:users[role]?200:401,json:async()=>({id:users[role]})};
});
createServer(async(req,res)=>{
 if(req.url.startsWith('/api/'))return api(req,res);
 const name=req.url.split('?')[0]==='/'?'index.html':req.url.slice(1).split('?')[0];
 if(!/^[a-z0-9-]+\.(html|css|js)$/.test(name)){res.writeHead(404);return res.end();}
 try{const bytes=await readFile(new URL('../public/'+name,import.meta.url));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(bytes);}catch{res.writeHead(404);res.end();}
}).listen(6130,'127.0.0.1',()=>console.log('Synthetic staff UI verification on http://127.0.0.1:6130; role@fixture.test / fixture; no provider IO'));
