// Local synthetic fixture only; real application projection and domain.
import {mkdir,writeFile} from 'node:fs/promises';
import {classEditingFixture} from './class-editing-fixture.mjs';
const f=classEditingFixture(),{store,staff,server}=f;
const cmd=(action,body={},id)=>store.command(staff.userId,{action,id,body:{requestId:crypto.randomUUID(),...body}});
const q=await cmd('participant',{name:'Test Member'}),c=await cmd('class',{title:'History navigation verification',startsAt:'2099-10-02T12:00:00Z',instructor:'Teacher',location:'Local Room',capacity:1,duration:45,creditRequired:false,waitlistEnabled:true});
const held=await cmd('reserve',{participantId:q.id,classId:c.id}),r=await cmd('reserve',{participantId:'p',classId:c.id,waitlistOnly:true});
await cmd('cancel',{},held.id);await cmd('promote',{},r.id);await cmd('attendance',{status:'present',reason:'Recorded special note'},r.id);await cmd('attendance',{status:'not_recorded',reason:'Clear attendance'},r.id);await cmd('cancel',{},r.id);await cmd('correct-cancellation',{classification:'early',reason:'Unchanged correction'},r.id);
const output=new URL('../docs/history-navigation-local/',import.meta.url);await mkdir(output,{recursive:true});
const baseline=JSON.stringify(f.snapshot()),initial=(await store.read(staff.userId)).revision;
await writeFile(new URL('fixture.json',output),JSON.stringify({classId:c.id,reservationId:r.id,otherReservationId:held.id,revision:initial},null,2));
const original=store.read;
store.read=async id=>{const result=await original(id);await writeFile(new URL('read-verification.json',output),JSON.stringify({stateUnchanged:JSON.stringify(f.snapshot())===baseline,revisionUnchanged:result.revision===initial,revision:result.revision},null,2));return result;};
await new Promise(resolve=>server.listen(10010,'127.0.0.1',resolve));
console.log(JSON.stringify({url:'http://127.0.0.1:10010',classId:c.id,reservationId:r.id,otherReservationId:held.id,login:'staff@local.test / member@local.test',password:'synthetic'}));
