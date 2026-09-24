// Synthetic loopback fixture only. No hosted writes, real credentials or outbound services.
import {mkdir,writeFile} from 'node:fs/promises';
import {classEditingFixture} from './class-editing-fixture.mjs';
const fixture=classEditingFixture(),{store,staff,server}=fixture;
const output=new URL('../docs/cancellation-notice-local/',import.meta.url);await mkdir(output,{recursive:true});
const command=(action,body={},id)=>store.command(staff.userId,{action,id,body:{requestId:crypto.randomUUID(),...body}});
const q=await command('participant',{name:'Other participant'}),old=await command('participant',{name:'Previously cancelled'});
const c=await command('class',{title:'Cancellation notice <test>',startsAt:'2099-10-02T12:00:00Z',instructor:'Recorded Teacher',location:'Recorded Room',capacity:1,duration:45,creditRequired:true,waitlistEnabled:true});
await command('issue-credit',{participantId:'p',quantity:1,reason:'Synthetic credit'});
await command('issue-credit',{participantId:old.id,quantity:1,reason:'Synthetic holder credit'});
const held=await command('reserve',{participantId:old.id,classId:c.id}),r=await command('reserve',{participantId:'p',classId:c.id,waitlistOnly:true});
await command('cancel',{},held.id);await command('promote',{},r.id);
const w=await command('reserve',{participantId:q.id,classId:c.id,waitlistOnly:true});
await writeFile(new URL('before.json',output),JSON.stringify(await store.read(staff.userId),null,2)+'\n');
const originalCommand=store.command;
store.command=async(actor,cmd)=>{const result=await originalCommand(actor,cmd);await writeFile(new URL('after.json',output),JSON.stringify(await store.read(staff.userId),null,2)+'\n');await writeFile(new URL('last-command.json',output),JSON.stringify({cmd,result},null,2)+'\n');return result;};
await new Promise(resolve=>server.listen(10012,'127.0.0.1',resolve));
console.log(JSON.stringify({url:'http://127.0.0.1:10012',classId:c.id,booked:r.id,waitlisted:w.id,previouslyCancelled:held.id,login:'staff@local.test / member@local.test',password:'synthetic'}));
