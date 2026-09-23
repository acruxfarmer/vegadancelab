import test from 'node:test';
import assert from 'node:assert/strict';
import {studioDate,defaultScheduleFilters,scheduleResults,visibleSelection,occurrenceOption} from '../public/schedule-navigation.js';
import {cancellationUI} from '../public/cancellation-ui.js';
const data=classes=>({context:{role:'staff'},classes});
const all={from:'',to:'',text:'',status:'all'};
const ids=r=>r.occurrences.map(c=>c.id);
test('studio calendar boundaries are Pacific, including spring forward, fall back and UTC year boundary',()=>{
 for(const [instant,day] of [['2026-03-08T07:59:59Z','2026-03-07'],['2026-03-08T08:00:00Z','2026-03-08'],['2026-03-08T09:59:59Z','2026-03-08'],['2026-03-08T10:00:00Z','2026-03-08'],['2026-03-09T06:59:59Z','2026-03-08'],['2026-03-09T07:00:00Z','2026-03-09'],['2026-11-01T06:59:59Z','2026-10-31'],['2026-11-01T07:00:00Z','2026-11-01'],['2026-11-01T08:30:00Z','2026-11-01'],['2026-11-01T09:30:00Z','2026-11-01'],['2026-11-02T07:59:59Z','2026-11-01'],['2026-11-02T08:00:00Z','2026-11-02'],['2027-01-01T07:59:59Z','2026-12-31']])assert.equal(studioDate(instant),day,instant);
 assert.equal(defaultScheduleFilters('2026-03-08T07:59:59Z').from,'2026-03-07');assert.equal(studioDate('bad'),null);
});
test('inclusive date filters cover 23-hour and 25-hour studio days without browser-zone dependence',()=>{
 for(const [day,times,expected] of [['2026-03-08',['2026-03-08T07:59:59Z','2026-03-08T08:00:00Z','2026-03-09T06:59:59Z','2026-03-09T07:00:00Z'],['1','2']],['2026-11-01',['2026-11-01T06:59:59Z','2026-11-01T07:00:00Z','2026-11-02T07:59:59Z','2026-11-02T08:00:00Z'],['1','2']]])assert.deepEqual(ids(scheduleResults(data(times.map((startsAt,i)=>({id:String(i),startsAt}))),{...all,from:day,to:day})),expected);
});
test('intersecting navigation filters use canonical status and current fields only, leaving source immutable',()=>{
 const d=data([{id:'past-open',status:'open',startsAt:'2000-01-01T12:00Z',title:'Jazz',instructor:'Alex',location:'Room A'},{id:'cancel',status:'cancelled',startsAt:'2099-01-01T12:00Z',title:'Jazz',instructor:'Sam',location:'Room B'},{id:'other',status:'archived',startsAt:'2099-01-01T12:00Z',title:'Other',editHistory:[{before:{title:'Jazz'}}]}]),before=structuredClone(d);
 assert.deepEqual(ids(scheduleResults(d,{...all,text:' jAzZ ',status:'open'})),['past-open']);assert.deepEqual(ids(scheduleResults(d,{...all,text:'room B',from:'2099-01-01',status:'cancelled'})),['cancel']);assert.deepEqual(ids(scheduleResults(d,{...all,text:'alex'})),['past-open']);assert.equal(scheduleResults(d,all).occurrences.length,3);assert.deepEqual(d,before);
});
test('chronological ordering, equal-start identities and undated legacy records are deterministic',()=>{
 const d=data([{id:'z',startsAt:'invalid'},{id:'b',startsAt:'2099-01-01T12:00Z'},{id:'a',startsAt:'2099-01-01T12:00Z'},{id:'y'}]);
 assert.deepEqual(ids(scheduleResults(d,all)),['a','b','y','z']);d.classes.reverse();assert.deepEqual(ids(scheduleResults(d,all)),['a','b','y','z']);assert.deepEqual(ids(scheduleResults(d,{...all,from:'2098-01-01'})),['a','b']);assert.match(occurrenceOption({id:'legacy'}),/unrecorded/);
});
test('invalid ranges fail intentionally and hidden selections never select a replacement',()=>{
 const d=data([{id:'a',startsAt:'2099-01-01T12:00Z'},{id:'b',startsAt:'2099-01-02T12:00Z'}]);
 for(const f of [{from:'2099-02-30'},{from:'2099-02-01',to:'2099-01-01'},{status:'past'}]){const r=scheduleResults(d,{...all,...f});assert.ok(r.error);assert.equal(visibleSelection('a',r),'');}
 const r=scheduleResults(d,{...all,from:'2099-01-02'});assert.equal(visibleSelection('a',r),'');assert.equal(visibleSelection('',r),'');assert.equal(visibleSelection('b',r),'b');
 assert.deepEqual(scheduleResults({...d,context:{role:'member'}},all).occurrences,[]);
});
test('dependent cancellation panels show only the selected occurrence and none when cleared',()=>{
 const source={...data([{id:'a',title:'A'},{id:'b',title:'B'}]),reservations:[{id:'r',classId:'b',status:'cancelled',participantId:'p'}],participants:[{id:'p',name:'P'}]};
 const ui=cancellationUI({getData:()=>source,escape:String});assert.equal(ui.render('schedule',{occurrenceId:''}),'');const html=ui.render('schedule',{occurrenceId:'a'});assert.ok(html.includes('policy-a'));assert.ok(!html.includes('policy-b'));assert.ok(!html.includes('booking r'));
});
