// Vega's existing studio calendar is Pacific; never use the browser's timezone.
export const studioTimeZone='America/Los_Angeles';
const compare=(a,b)=>a<b?-1:a>b?1:0;
export function studioDate(value){
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:studioTimeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const part=type=>parts.find(p=>p.type===type).value;return `${part('year')}-${part('month')}-${part('day')}`;
}
export function defaultScheduleFilters(now=new Date().toISOString()){return {from:studioDate(now),to:'',text:'',status:'all'};}
const validDay=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function scheduleResults(data,filters){
 if(data?.context?.role!=='staff')return {occurrences:[],error:''};
 const {from='',to='',text='',status='all'}=filters;
 if((from&&!validDay(from))||(to&&!validDay(to)))return {occurrences:[],error:'Enter a valid studio calendar date.'};
 if(from&&to&&from>to)return {occurrences:[],error:'From date must be on or before through date.'};
 if(!['all','open','cancelled'].includes(status))return {occurrences:[],error:'Choose an available status filter.'};
 const query=text.trim().toLowerCase();
 const occurrences=(data.classes||[]).filter(c=>{
  const day=studioDate(c.startsAt);
  return (!from||(day&&day>=from))&&(!to||(day&&day<=to))&&(status==='all'||c.status===status)&&[c.title,c.instructor,c.location].some(v=>String(v??'').toLowerCase().includes(query));
 }).slice().sort((a,b)=>{
  const at=Date.parse(a.startsAt),bt=Date.parse(b.startsAt);
  return (Number.isFinite(at)?at:Infinity)-(Number.isFinite(bt)?bt:Infinity)||compare(a.id,b.id);
 });
 return {occurrences,error:''};
}
export function visibleSelection(selectedId,result){return result.occurrences.some(c=>c.id===selectedId)?selectedId:'';}
export function occurrenceOption(c){
 const start=studioDate(c.startsAt)?new Intl.DateTimeFormat('en-US',{timeZone:studioTimeZone,year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(new Date(c.startsAt)):'unrecorded';
 return `${c.title||'unrecorded'} · ${start} · ${c.status||'unrecorded'} · ${c.instructor||'unrecorded'} · ${c.location||'unrecorded'} · ${c.id}`;
}
export function scheduleNavigationUI({getData,isStaff,getSelected,setSelected,escape:e,render}){
 let scope=null,filters=defaultScheduleFilters();
 function project(){
  if(!isStaff())return {occurrences:[],error:''};
  const d=getData(),key=JSON.stringify([d.context.userId,d.context.tenantId,d.context.businessId]);
  if(key!==scope){if(scope!==null)setSelected('');scope=key;filters=defaultScheduleFilters();}
  const result=scheduleResults(d,filters);setSelected(visibleSelection(getSelected(),result));return result;
 }
 function controls(result){return `<section class="card schedule-navigation" aria-label="Find an occurrence"><h2>Find an occurrence</h2><p>Calendar dates use ${studioTimeZone}. Filters only change this list. Select an occurrence to view its roster and history.</p><form id="schedule-filters"><div class="form-grid"><label class="field">From date<input type="date" name="from" value="${e(filters.from)}"></label><label class="field">Through date<input type="date" name="to" value="${e(filters.to)}"></label><label class="field">Search title, instructor or location<input type="search" name="text" maxlength="200" value="${e(filters.text)}"></label><label class="field">Occurrence status<select name="status">${['all','open','cancelled'].map(s=>`<option value="${s}" ${filters.status===s?'selected':''}>${s==='all'?'All statuses':s==='open'?'Open':'Cancelled'}</option>`).join('')}</select></label></div><div class="row"><button class="button secondary">Apply filters</button><button type="button" class="text-button" data-schedule-all-dates>All dates</button><button type="button" class="text-button" data-schedule-today>Reset to today onward</button></div></form><p role="${result.error?'alert':'status'}">${result.error?e(result.error):`${result.occurrences.length} matching occurrence${result.occurrences.length===1?'':'s'}`}</p></section>`;}
 document.addEventListener('submit',event=>{
  if(event.target.id!=='schedule-filters')return;event.preventDefault();if(!isStaff())return;
  filters=Object.fromEntries(new FormData(event.target));render();document.querySelector('#schedule-filters button')?.focus();
 });
 document.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||!isStaff())return;
  if(b.hasAttribute('data-schedule-all-dates')){filters={...filters,from:'',to:''};render();document.querySelector('[data-schedule-all-dates]')?.focus();}
  if(b.hasAttribute('data-schedule-today')){filters=defaultScheduleFilters();render();document.querySelector('[data-schedule-today]')?.focus();}
 });
 return {project,controls};
}
