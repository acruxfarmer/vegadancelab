import test from 'node:test';
import assert from 'node:assert/strict';
import {attendanceUI} from '../public/attendance-ui.js';

test('history filters follow exact selection lifetime across refresh, hidden records and authority changes',()=>{
 const originalDocument=globalThis.document,originalFormData=globalThis.FormData,listeners={};
 globalThis.document={addEventListener:(type,fn)=>(listeners[type]??=[]).push(fn),querySelector:()=>null,querySelectorAll:()=>[]};
 globalThis.FormData=class{constructor(form){return Object.entries(form.fields);}};
 try{
  let data={context:{role:'staff',userId:'s',tenantId:'t',businessId:'b'},classes:[{id:'c',title:'C',capacity:1},{id:'other'}],participants:[{id:'p',name:'Same'}],activity:[],reservations:[{id:'r',classId:'c',participantId:'p',status:'cancelled',createdAt:'2026-01-01',attendanceHistory:[{id:'h',reason:'needle',to:'present'}]},{id:'q',classId:'c',participantId:'p',status:'cancelled',createdAt:'2026-01-01'}]},html='',selected='c',writes=0;
  const render=()=>html=ui.render(selected),ui=attendanceUI({getData:()=>data,isStaff:()=>data.context.role==='staff',escape:String,modal:()=>{},mutate:()=>writes++,notify:()=>{},date:()=>'',time:()=>'',render});
  const click=(selector,dataset={})=>{const node={dataset};listeners.click.forEach(fn=>fn({target:{closest:s=>s===selector?node:null}}));};
  const submit=(id,fields)=>listeners.submit.forEach(fn=>fn({target:{id,fields},preventDefault(){}}));
  const open=id=>click('[data-reservation-history-open]',{reservationHistoryOpen:id});
  render();open('r');submit('reservation-history-filters',{type:'attendance-change',text:'needle'});assert.match(html,/Showing 1 of 2/);
  // A same-identity refresh keeps filters and consumes newly projected evidence.
  data=structuredClone(data);data.reservations[0].attendanceHistory.push({id:'h2',reason:'needle',to:'absent'});render();assert.match(html,/Showing 2 of 3/);
  open('q');assert.match(html,/Showing 1 of 1/);assert.doesNotMatch(html,/value="needle"/);
  open('r');submit('reservation-history-filters',{type:'attendance-change',text:'needle'});
  data.context.businessId='new';render();assert.doesNotMatch(html,/id="reservation-history"/);open('r');assert.match(html,/Showing 3 of 3/);
  submit('roster-filters',{text:'',booking:'reserved',attendance:'all'});assert.doesNotMatch(html,/id="reservation-history"/);
  click('[data-reset-roster-filters]');assert.doesNotMatch(html,/id="reservation-history"/);open('r');assert.match(html,/Showing 3 of 3/);
  data.reservations=data.reservations.filter(r=>r.id!=='r');render();assert.doesNotMatch(html,/id="reservation-history"/);
  open('q');selected='other';render();assert.doesNotMatch(html,/id="reservation-history"/);
  selected='c';render();open('q');ui.reconcile(null);render();assert.doesNotMatch(html,/id="reservation-history"/);
  open('q');data.context.role='member';ui.reconcile(null);assert.equal(ui.render('c'),'');data.context.role='staff';render();assert.doesNotMatch(html,/id="reservation-history"/);
  assert.equal(writes,0);
 }finally{globalThis.document=originalDocument;globalThis.FormData=originalFormData;}
});
