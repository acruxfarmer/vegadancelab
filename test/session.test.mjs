import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSession} from '../public/session.js';
function setup(fetcher){const values=new Map(),events=[];let time=0;const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};const options={storage,fetcher,now:()=>time,onPending:()=>events.push('hidden'),onLost:()=>events.push('signed-out'),schedule:()=>1,cancel:()=>{}};return {session:createSession(options),options,values,events,advance:()=>time=121000};}
const reply=(role='member')=>({ok:true,json:async()=>({accessToken:`${role}.access`,refreshToken:'rotated-refresh',expiresIn:120})});
test('reload restores credentials and exchanges refresh token without persisting authority',async()=>{
 let sent;const s=setup(async(_url,init)=>{sent=JSON.parse(init.body);return reply();});
 s.session.accept({accessToken:'old.access',refreshToken:'old-refresh',expiresIn:120,role:'staff'});
 assert.equal([...s.values.values()][0].includes('staff'),false);
 const restored=createSession(s.options);assert.equal(restored.restore(),true);assert.equal(await restored.refresh(),'member.access');
 assert.deepEqual(sent,{refreshToken:'old-refresh'});assert.equal(JSON.parse([...s.values.values()][0]).refreshToken,'rotated-refresh');
});
test('expired access token refreshes once across concurrent calls and hides content first',async()=>{
 let done,calls=0;const s=setup(()=>{calls++;assert.equal(s.events.at(-1),'hidden');return new Promise(r=>done=r);});
 s.session.accept({accessToken:'expired.access',refreshToken:'refresh',expiresIn:120});s.advance();
 const a=s.session.access(),b=s.session.access();assert.equal(calls,1);done(reply());assert.deepEqual(await Promise.all([a,b]),['member.access','member.access']);
});
test('invalid refresh clears persisted credentials and stays signed out',async()=>{
 const s=setup(async()=>({ok:false,status:401}));s.session.accept({accessToken:'old',refreshToken:'invalid',expiresIn:120});
 await assert.rejects(s.session.refresh());assert.deepEqual(s.events,['hidden','signed-out']);assert.equal(s.values.size,0);assert.equal(s.session.active(),false);
});
test('late refresh cannot restore signed-out or replacement account',async()=>{
 let done;const s=setup(()=>new Promise(r=>done=r));s.session.accept({accessToken:'staff',refreshToken:'staff-refresh',expiresIn:120});
 const p=s.session.refresh();s.session.clear();s.session.accept({accessToken:'member',refreshToken:'member-refresh',expiresIn:120});
 done(reply('staff'));await assert.rejects(p);assert.equal(await s.session.access(),'member');assert.equal(JSON.parse([...s.values.values()][0]).refreshToken,'member-refresh');
});
test('network and malformed refresh responses fail closed',async()=>{
 for(const fetcher of [async()=>{throw new Error('offline');},async()=>({ok:true,json:async()=>({accessToken:'x'})})]){
 const s=setup(fetcher);s.session.accept({accessToken:'old',refreshToken:'r',expiresIn:120});await assert.rejects(s.session.refresh());assert.equal(s.values.size,0);assert.equal(s.session.active(),false);
 }
});
