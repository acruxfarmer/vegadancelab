// Read-only, reusable operating metrics over an already authorized business projection.
export function reportDay(value,timeZone='UTC'){
 if(!value||!Number.isFinite(Date.parse(value)))return null;
 const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
 const part=k=>parts.find(p=>p.type===k).value;return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftReportDay(day,days){const d=new Date(day+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function reportWeek(day){const n=new Date(day+'T12:00:00Z').getUTCDay();return shiftReportDay(day,-((n+6)%7));}
const validDay=v=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function reportAllowed(d){const a=d?.staffAccess,c=d?.context;return c?.role==='staff'&&a?.permissions?.includes('reports.read')&&['tenantId','businessId','userId'].every(k=>a[k]===c[k]&&!!c[k]);}
const sum=(rows,k)=>rows.some(r=>r[k]===null)?null:rows.reduce((n,r)=>n+r[k],0);
function aggregate(rows){
 const active=rows.filter(r=>!r.cancelled),ended=active.filter(r=>r.ended),unknownEnd=active.some(r=>!r.endKnown),capacity=sum(active,'capacity'),endedCapacity=unknownEnd?null:sum(ended,'capacity');
 const attended=unknownEnd?null:sum(ended,'attended'),booked=sum(active,'booked'),unrecorded=unknownEnd?null:sum(ended,'unrecorded');
 const unreliable=ended.some(r=>r.unreliable),rate=ended.length===0||endedCapacity===0?null:endedCapacity===null||attended===null||unreliable?null:100*attended/endedCapacity;
 return {classes:rows.length,cancelledClasses:rows.filter(r=>r.cancelled).length,endedClasses:ended.length,capacity,endedCapacity,booked,attended,unrecorded,
  noShows:unknownEnd?null:sum(ended,'noShows'),early:sum(rows,'early'),late:sum(rows,'late'),unclassified:sum(rows,'unclassified'),waiting:sum(rows,'waiting'),demand:sum(rows,'demand'),promoted:sum(rows,'promoted'),
  utilization:rate,utilizationState:rate!==null?'known':unknownEnd?'unavailable':!ended.length||endedCapacity===0?'not-applicable':'unavailable',
  bookingFillState:capacity===null||booked===null||active.some(r=>r.unreliable)?'unavailable':capacity===0?'not-applicable':'known',
  bookingFill:capacity>0&&booked!==null&&!active.some(r=>r.unreliable)?100*booked/capacity:null,
  averageAttended:ended.length&&attended!==null?attended/ended.length:null,quality:rows.filter(r=>r.quality.length).length};
}
export function attendanceReport(d,{from='',to='',instructor='',group='day',timeZone='UTC',now=new Date().toISOString()}={}){
 if(!reportAllowed(d))return {error:'Your staff role does not allow management reporting. Ask your business owner for help.',rows:[]};
 if((from&&!validDay(from))||(to&&!validDay(to))||(from&&to&&from>to))return {error:'Choose a valid date range, with the start on or before the end.',rows:[]};
 if(!['day','week'].includes(group))return {error:'Choose daily or weekly trends.',rows:[]};
 try{reportDay(now,timeZone);}catch{return {error:'The business reporting time zone is unavailable.',rows:[]};}
 if(!Number.isFinite(Date.parse(now)))return {error:'The report time is unavailable.',rows:[]};
 const scoped=r=>(!r.tenantId||r.tenantId===d.context.tenantId)&&(!r.businessId||r.businessId===d.context.businessId);
 const classes=(d.classes||[]).filter(scoped),reservations=(d.reservations||[]).filter(scoped),counts=new Map(),bookingCounts=new Map();
 for(const c of classes)counts.set(c.id,(counts.get(c.id)||0)+1);
 for(const r of reservations)bookingCounts.set(r.id,(bookingCounts.get(r.id)||0)+1);
 const missingDates=classes.filter(c=>!reportDay(c.startsAt,timeZone)).length;
 const rows=classes.filter(c=>{const day=reportDay(c.startsAt,timeZone);return (!from||(day&&day>=from))&&(!to||(day&&day<=to))&&(!instructor||c.instructor===instructor);}).map(c=>{
  const records=reservations.filter(r=>r.classId===c.id),day=reportDay(c.startsAt,timeZone),cancelled=c.status==='cancelled';
  const capacity=Number.isInteger(c.capacity)&&c.capacity>=0?c.capacity:null,end=Number.isFinite(c.duration)&&c.duration>0&&day?Date.parse(c.startsAt)+c.duration*60000:null,ended=end!==null&&end<=Date.parse(now);
  const duplicate=counts.get(c.id)!==1||records.some(r=>!r.id||bookingCounts.get(r.id)!==1),invalidStatus=!['open','cancelled'].includes(c.status)||records.some(r=>!['reserved','waitlisted','cancelled'].includes(r.status));
  const booked=records.filter(r=>r.status==='reserved').length,attended=records.filter(r=>r.status==='reserved'&&r.attendanceStatus==='present').length,absent=records.filter(r=>r.status==='reserved'&&r.attendanceStatus==='absent').length;
  const unrecorded=booked-attended-absent,early=records.filter(r=>r.status==='cancelled'&&r.cancellation?.classification==='early').length,late=records.filter(r=>r.status==='cancelled'&&r.cancellation?.classification==='late').length;
  const cancelledRecords=records.filter(r=>r.status==='cancelled').length,waiting=records.filter(r=>r.status==='waitlisted').length;
  const demand=records.filter(r=>r.status==='waitlisted'||r.waitlistHistory?.some(h=>['joined','promoted'].includes(h.action))).length,promoted=records.filter(r=>r.waitlistHistory?.some(h=>h.action==='promoted')).length;
  const quality=[];
  if(duplicate)quality.push('Conflicting duplicate records');if(invalidStatus)quality.push('Unknown class or booking status');if(capacity===null)quality.push('Capacity unavailable');if(end===null)quality.push('Class end time unavailable');
  if(capacity!==null&&booked>capacity)quality.push('Bookings exceed capacity');if(cancelled&&(booked||waiting||attended))quality.push('Cancelled class has active participation');
  if(ended&&unrecorded)quality.push('Attendance is incomplete');if(records.some(r=>r.status!=='reserved'&&['present','absent'].includes(r.attendanceStatus)))quality.push('Attendance conflicts with booking status');
  const unreliable=duplicate||invalidStatus||capacity===null||(capacity!==null&&booked>capacity)||quality.includes('Attendance conflicts with booking status');
  const count=v=>duplicate||invalidStatus?null:v;
  return {id:c.id,title:c.title||'Class name unavailable',instructor:c.instructor||'Instructor unavailable',day,cancelled,ended,endKnown:end!==null,capacity:duplicate||invalidStatus?null:capacity,booked:count(booked),attended:count(attended),noShows:count(absent),unrecorded:count(unrecorded),early:count(early),late:count(late),unclassified:count(cancelledRecords-early-late),waiting:count(waiting),demand:count(demand),promoted:count(promoted),quality,unreliable,
   utilization:!cancelled&&ended&&capacity>0&&!unreliable?100*attended/capacity:null,utilizationState:cancelled||(!ended&&end!==null)||capacity===0?'not-applicable':unreliable||end===null?'unavailable':'known'};
 }).sort((a,b)=>(a.day||'9999').localeCompare(b.day||'9999')||a.title.localeCompare(b.title)||String(a.id).localeCompare(String(b.id)));
 const buckets=new Map(),teachers=new Map();
 for(const r of rows){if(r.day){const key=group==='week'?reportWeek(r.day):r.day;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(r);}if(!teachers.has(r.instructor))teachers.set(r.instructor,[]);teachers.get(r.instructor).push(r);}
 const ranked=rows.filter(r=>r.utilization!==null&&r.unrecorded===0).slice().sort((a,b)=>b.utilization-a.utilization||a.title.localeCompare(b.title));
 return {error:'',rows,summary:aggregate(rows),trends:[...buckets].map(([period,items])=>({period,...aggregate(items)})),instructors:[...teachers].map(([name,items])=>({name,...aggregate(items)})),ranked,missingDates,orphanBookings:reservations.filter(r=>!classes.some(c=>c.id===r.classId)).length,instructorOptions:[...new Set(classes.map(c=>c.instructor).filter(Boolean))].sort(),from,to,group,timeZone};
}
