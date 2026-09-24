// Read-only projection over existing evidence. Never joins by name, time or current status.
export const reservationHistoryTypes=Object.freeze(['creation','waitlist-promotion','cancellation','cancellation-correction','attendance-change']);
const missing='unrecorded',recorded=v=>v===undefined||v===null||v===''?missing:structuredClone(v);
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const evidenceKeys=['id','action','createdAt','actorId','actorRole','requestId','reason','from','to','outcome','creditOutcome','revision','attendanceHistoryId','classCancellationEventId','subjectId'];
const evidenceRecord=h=>Object.fromEntries(evidenceKeys.filter(k=>h[k]!==undefined).map(k=>[k,structuredClone(h[k])]));
export function reservationHistory(data,reservationId){
 const empty={contractVersion:1,reservationId,events:[],unlinkedEvidence:[]};
 if(data?.context?.role!=='staff')return empty;
 const r=data.reservations?.find(r=>r.id===reservationId),c=data.classes?.find(c=>c.id===r?.classId);if(!r||!c)return empty;
 const groups=new Map(),anonymous=new Map(),unlinked=[];
 function add(type,h,source,values={},anchor=h.id){
  const base=stable([source,evidenceRecord(h)]),n=anonymous.get(base)||0;if(!anchor)anonymous.set(base,n+1);
  const key=stable([r.id,type,anchor?['record',anchor]:['unrecorded',base,n]]);
  if(!groups.has(key))groups.set(key,{key,type,records:[]});
  const g=groups.get(key);append(g,h,source,values);return g;
 }
 function append(g,h,source,values={}){
  const item={source,record:evidenceRecord(h),values:{actorId:h.actorId,actorRole:h.actorRole,recordedAt:h.createdAt,requestId:h.requestId,reason:h.reason,...values}};
  if(!g.records.some(x=>stable(x)===stable(item)))g.records.push(item);
 }
 function unresolved(h,source,reason){unlinked.push({source,record:evidenceRecord(h),relationship:reason});}
 const activity=(data.activity||[]).filter(h=>h.subjectId===r.id);
 const creations=activity.filter(h=>h.action==='reserve');
 let creation;
 // A reserve activity explicitly names the reservation it created. Current state is never a creation snapshot.
 if(r.createdAt||creations.length){creation=add('creation',{createdAt:r.createdAt},'reservation.createdAt',{},'creation');for(const h of creations)append(creation,h,'activity');}
 for(const h of r.attendanceHistory||[])add('attendance-change',h,'attendanceHistory',{beforeAttendance:h.from,afterAttendance:h.to});
 for(const h of r.cancellationHistory||[]){
  if(!['cancel','correction'].includes(h.action)){unresolved(h,'cancellationHistory','Unrecognized recorded action; relationship unrecorded.');continue;}
  add(h.action==='correction'?'cancellation-correction':'cancellation',h,'cancellationHistory',{beforeClassification:h.from,afterClassification:h.outcome==='applied'?h.to:undefined,requestedClassification:h.to,outcome:h.outcome,creditOutcome:h.creditOutcome});
 }
 for(const h of r.waitlistHistory||[])if(h.action==='promoted')add('waitlist-promotion',h,'waitlistHistory',{beforeBooking:h.from,afterBooking:h.to});
 function candidates(type,h){return [...groups.values()].filter(g=>g.type===type&&g.records.some(x=>h.requestId&&h.actorId&&x.record.requestId===h.requestId&&x.record.actorId===h.actorId));}
 for(const h of r.waitlistHistory||[]){
  if(h.action==='promoted')continue;
  const type=h.action==='joined'?'creation':['left','closed'].includes(h.action)?'cancellation':null;
  const matched=type?candidates(type,h):[];
  // Class-cancellation evidence may instead carry a direct event identity.
  const linked=type==='cancellation'&&h.classCancellationEventId?[...groups.values()].filter(g=>g.type===type&&g.records.some(x=>x.record.classCancellationEventId===h.classCancellationEventId)):[];
  const targets=[...new Set([...matched,...linked])];
  if(targets.length===1)append(targets[0],h,'waitlistHistory',{beforeBooking:h.from,afterBooking:h.to});
  else unresolved(h,'waitlistHistory',targets.length?'Ambiguous explicit links; no single action selected.':'Action relationship unrecorded; not merged by timestamp.');
 }
 for(const h of activity){
  if(h.action==='reserve')continue;
  const types={attendance:'attendance-change',promote:'waitlist-promotion',cancel:'cancellation','correct-cancellation':'cancellation-correction'};
  const type=Object.hasOwn(types,h.action)?types[h.action]:null;if(!type)continue;
  if(type==='attendance-change'&&h.attendanceHistoryId){
   const target=[...groups.values()].find(g=>g.type===type&&g.records.some(x=>x.source==='attendanceHistory'&&x.record.id===h.attendanceHistoryId));
   if(target)append(target,h,'activity');else unresolved(h,'activity','Linked attendance history record unavailable; details unrecorded.');
  }else{const targets=candidates(type,h);if(targets.length===1)append(targets[0],h,'activity');else unresolved(h,'activity',targets.length?'Ambiguous explicit links; no single action selected.':'Action relationship unrecorded; may describe an action already in the timeline.');}
 }
 // Only the affected entry for this exact reservation is projected; never expose other bookings here.
 for(const g of groups.values())if(g.type==='cancellation'){
  const eventIds=[...new Set(g.records.map(x=>x.record.classCancellationEventId).filter(Boolean))];
  for(const eventId of eventIds){
   const matches=(c.cancellationHistory||[]).filter(h=>h.id===eventId);
   for(const h of matches){const affected=(h.affected||[]).filter(a=>a.reservationId===r.id&&a.participantId===r.participantId);
    if(affected.length===1)append(g,h,'occurrence.cancellationHistory',{beforeBooking:affected[0].from,afterBooking:affected[0].to,creditOutcome:affected[0].creditOutcome});
    else unresolved({id:h.id,classCancellationEventId:eventId},'occurrence.cancellationHistory','Affected reservation relationship ambiguous or unrecorded.');
   }
   if(!matches.length)unresolved({classCancellationEventId:eventId},'occurrence.cancellationHistory','Linked occurrence event unavailable; details unrecorded.');
  }
 }
 const events=[...groups.values()].map(g=>{
  const records=g.records.sort((a,b)=>compare(stable(a),stable(b))),conflicts={};
  const value=k=>{const vals=[...new Map(records.map(x=>x.values[k]).filter(v=>v!==undefined&&v!==null&&v!=='').map(v=>[stable(v),v])).values()];if(vals.length>1){conflicts[k]=vals;return missing;}return recorded(vals[0]);};
  const before={bookingStatus:value('beforeBooking'),attendanceStatus:value('beforeAttendance'),cancellationClassification:value('beforeClassification')},after={bookingStatus:value('afterBooking'),attendanceStatus:value('afterAttendance'),cancellationClassification:value('afterClassification')};
  return {contractVersion:1,eventId:g.key,type:g.type,reservationId:r.id,participantId:r.participantId,occurrenceId:r.classId,actor:{id:value('actorId'),role:value('actorRole')},recordedAt:value('recordedAt'),requestId:value('requestId'),reason:value('reason'),outcome:value('outcome'),creditOutcome:value('creditOutcome'),before,after,requested:{cancellationClassification:value('requestedClassification')},evidence:records.map(({source,record})=>({source,record})),conflicts};
 }).sort((a,b)=>{const at=Date.parse(a.recordedAt),bt=Date.parse(b.recordedAt);return (Number.isFinite(bt)?bt:-Infinity)-(Number.isFinite(at)?at:-Infinity)||compare(a.eventId,b.eventId);});
 // Unlinked supporting records are deliberately not counted as additional actions.
 return {...empty,participantId:r.participantId,occurrenceId:r.classId,events,unlinkedEvidence:unlinked.sort((a,b)=>compare(stable(a),stable(b)))};
}
const labels={creation:'Reservation created','waitlist-promotion':'Waitlist promotion',cancellation:'Cancellation','cancellation-correction':'Cancellation correction','attendance-change':'Attendance change'};
export function reservationHistoryHTML(data,reservationId,e){
 const h=reservationHistory(data,reservationId);if(!h.occurrenceId)return '';
 const r=data.reservations.find(r=>r.id===reservationId);
 const display=v=>Array.isArray(v)?`<ul>${v.map(x=>`<li>${display(x)}</li>`).join('')}</ul>`:v&&typeof v==='object'?`<dl>${Object.entries(v).map(([k,x])=>`<dt>${e(k)}</dt><dd>${display(x)}</dd>`).join('')}</dl>`:e(String(v));
 const detail=(title,value)=>`<details><summary>${e(title)}</summary>${display(value)}</details>`;
 return `<section class="card reservation-history" id="reservation-history" tabindex="-1" aria-labelledby="reservation-history-heading"><h2 id="reservation-history-heading">Reservation history</h2><p>Read-only · Reservation ${e(r.id)} · Participant ${e(r.participantId)} · Occurrence ${e(r.classId)}</p><p>Current booking: ${e(recorded(r.status))} · Current attendance: ${e(recorded(r.attendanceStatus))}. Current values are not historical snapshots.</p><button type="button" class="text-button" data-close-reservation-history>Close reservation history</button><p>${h.events.length} recorded timeline entries. Newest recorded time first; missing times last; ties use stable event identity. Missing historical details are unrecorded.</p>${h.events.length?`<ol>${h.events.map(x=>`<li data-reservation-history-event="${e(x.type)}" data-event-id="${e(x.eventId)}"><h3>${labels[x.type]}</h3><p>Recorded timestamp: ${e(x.recordedAt)}<br>Actor: ${e(x.actor.id)} · Role: ${e(x.actor.role)}<br>Outcome: ${e(x.outcome)}<br>Reason: ${e(x.reason)}</p>${detail('Before',x.before)}${detail('After',x.after)}${x.type==='cancellation-correction'?detail('Requested classification (not necessarily applied)',x.requested):''}${detail('Recorded credit consequence',x.creditOutcome)}${Object.keys(x.conflicts).length?`<p>Conflicting evidence; a single value is unrecorded.</p>${detail('Conflicting recorded values',x.conflicts)}`:''}${detail('Evidence references and recorded detail',{eventId:x.eventId,requestId:x.requestId,records:x.evidence})}</li>`).join('')}</ol>`:'<p>No recorded timeline entries. Historical details: unrecorded.</p>'}${h.unlinkedEvidence.length?`<h3>Unlinked supporting evidence</h3><p>Relationships are ambiguous or unrecorded. These records may describe timeline entries above; they are not counted as additional actions.</p>${detail('Inspect unlinked records',h.unlinkedEvidence)}`:''}</section>`;
}
