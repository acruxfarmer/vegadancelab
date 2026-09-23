import test from 'node:test';
import assert from 'node:assert/strict';
import {rosterResults,defaultRosterFilters,attendanceValue,attendanceLabel} from '../public/roster-navigation.js';
const fixture=()=>({context:{role:'staff'},classes:[{id:'c',capacity:2},{id:'other'}],participants:[{id:'p',name:'Alex <Smith>'},{id:'q',name:'Alex <Smith>'},{id:'z',name:'Morgan'}],reservations:[
 {id:'r2',classId:'c',participantId:'q',status:'reserved',attendanceStatus:'present'},
 {id:'r1',classId:'c',participantId:'p',status:'reserved',attendanceStatus:'absent'},
 {id:'old',classId:'c',participantId:'p',status:'cancelled',attendanceStatus:'not_recorded',attendanceHistory:[{to:'present'}]},
 {id:'waiting',classId:'c',participantId:'z',status:'waitlisted'},
 {id:'unknown',classId:'c',participantId:'z',status:'legacy',attendanceStatus:'legacy'},
 {id:'outside',classId:'other',participantId:'p',status:'reserved',attendanceStatus:'present'}]});
const ids=result=>result.rows.map(r=>r.id);
test('roster filters intersect canonical current states and names without coalescing identities or reordering',()=>{
 const d=fixture(),f=defaultRosterFilters();assert.deepEqual(ids(rosterResults(d,'c',{...f,text:'  aLEX <sMITH> '})),['r2','r1','old']);
 assert.deepEqual(ids(rosterResults(d,'c',{...f,text:'alex',booking:'reserved',attendance:'absent'})),['r1']);
 assert.deepEqual(ids(rosterResults(d,'c',{...f,booking:'cancelled',attendance:'present'})),[]);
 assert.deepEqual(ids(rosterResults(d,'c',{...f,attendance:'not_recorded'})),['old','waiting']);
 assert.deepEqual(ids(rosterResults(d,'c',f)),['r2','r1','old','waiting','unknown']);
 assert.equal(rosterResults(d,'c',{...f,text:'absent name'}).total,5);
});
test('projection is immutable and leaves full totals, queue and eligibility inputs intact',()=>{
 const d=fixture(),before=structuredClone(d),f=defaultRosterFilters();
 for(const booking of ['all','reserved','waitlisted','cancelled'])for(const attendance of ['all','present','absent','not_recorded'])rosterResults(d,'c',{...f,booking,attendance,text:'Alex'});
 assert.deepEqual(d,before);assert.equal(d.reservations.filter(r=>r.classId==='c'&&r.status==='reserved').length,2);assert.equal(d.classes[0].capacity,2);
});
test('legacy attendance normalization matches existing absent-value behavior; unknown states are not silently classified',()=>{
 assert.equal(attendanceValue(undefined),'not_recorded');assert.equal(attendanceValue(null),'not_recorded');assert.equal(attendanceValue('legacy'),'legacy');assert.equal(attendanceLabel('legacy'),'Unrecognized (legacy)');
 const d=fixture(),f=defaultRosterFilters();assert.ok(ids(rosterResults(d,'c',f)).includes('unknown'));
 for(const attendance of ['present','absent','not_recorded'])assert.ok(!ids(rosterResults(d,'c',{...f,attendance})).includes('unknown'));
 assert.ok(rosterResults(d,'c',{...f,booking:'checked_in'}).error);
});
test('only staff-selected authorized occurrences produce rows; IDs are not treated as participant-name search',()=>{
 const d=fixture(),f=defaultRosterFilters();for(const id of ['',undefined,'missing'])assert.deepEqual(rosterResults(d,id,f),{rows:[],total:0,error:''});
 assert.deepEqual(rosterResults({...d,context:{role:'member'}},'c',f).rows,[]);
 assert.deepEqual(ids(rosterResults(d,'c',{...f,text:'r2'})),[]);
 assert.equal(rosterResults(d,'other',f).total,1);
});
