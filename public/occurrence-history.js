// Read-only V1 projection. Explicit event links, never timestamps, identify an action.
export const occurrenceHistoryTypes=Object.freeze(['creation','edit','cancellation','creation-from-existing']);
const missing='unrecorded';
const recorded=v=>v===undefined||v===null||v===''?missing:structuredClone(v);
const stable=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const fields=['title','instructor','location','category','capacity','duration','startsAt','cancellationCutoffMinutes','creditRequired','waitlistEnabled'];
const snapshot=v=>v&&typeof v==='object'?Object.fromEntries(fields.map(k=>[k,recorded(v[k])])):missing;

export function occurrenceHistory(data,occurrenceId){
 if(data?.context?.role!=='staff')return [];
 const c=data.classes?.find(c=>c.id===occurrenceId);if(!c)return [];
 const groups=new Map(),anonymous=new Map();
 function add(type,h,source,linkedId){
  const id=linkedId||h.id;
  // Without a recorded identity, identical-looking actions remain separate.
  const base=stable([type,source,h]),n=anonymous.get(base)||0;
  if(!id)anonymous.set(base,n+1);
  const key=id?stable([type,id]):stable([type,'unrecorded',base,n]);
  if(!groups.has(key))groups.set(key,{key,type,id:recorded(id),records:[]});
  const records=groups.get(key).records,record={...structuredClone(h),source};
  if(!records.some(r=>stable(r)===stable(record)))records.push(record);
 }
 const p=c.creationProvenance;
 if(p)add('creation-from-existing',p,'creationProvenance');
 for(const h of c.editHistory||[])add('edit',h,'editHistory');
 for(const h of c.cancellationHistory||[])add('cancellation',h,'cancellationHistory');
 for(const h of data.activity||[]){
  if(h.subjectId!==c.id)continue;
  if(h.action==='class'){
   const linked=p?.id&&(h.id===p.id||h.creationProvenanceId===p.id);
   add(linked||h.creationProvenanceId||h.sourceClassId?'creation-from-existing':'creation',h,'activity',h.creationProvenanceId||h.id);
  }
  if(h.action==='edit-class')add('edit',h,'activity',h.classEditEventId||h.id);
  if(h.action==='cancel-class')add('cancellation',h,'activity',h.classCancellationEventId||h.id);
 }
 return [...groups.values()].map(g=>{
  const records=g.records.sort((a,b)=>compare(stable(a),stable(b))),conflicts=[];
  function value(key){
   const values=records.map(r=>r[key]).filter(v=>v!==undefined&&v!==null&&v!=='');
   const unique=[...new Map(values.map(v=>[stable(v),v])).values()];
   if(unique.length>1){conflicts.push(key);return missing;}
   return recorded(unique[0]);
  }
  const event={contractVersion:1,key:g.key,eventId:g.id,type:g.type,occurrenceId:c.id,
   actor:{id:value('actorId'),role:value('actorRole')},recordedAt:value('createdAt'),
   requestId:value('requestId'),reason:value('reason'),before:snapshot(value('before')),after:snapshot(value('after')),
   provenance:g.type==='creation-from-existing'?{sourceOccurrenceId:value('sourceClassId'),sourceVersion:value('sourceVersion'),sourceDetails:snapshot(value('sourceDetails')),createdDetails:snapshot(value('details'))}:missing,
   evidence:records.map(r=>({source:r.source,id:recorded(r.id)})),conflicts};
  // Retain conflicting recorded values explicitly; never silently choose one.
  event.conflictingEvidence=Object.fromEntries(conflicts.map(k=>[k,records.filter(r=>r[k]!==undefined).map(r=>({source:r.source,id:recorded(r.id),value:structuredClone(r[k])}))]));
  return event;
 }).sort((a,b)=>{
  const at=Date.parse(a.recordedAt),bt=Date.parse(b.recordedAt);
  return (Number.isFinite(bt)?bt:-Infinity)-(Number.isFinite(at)?at:-Infinity)||compare(a.key,b.key);
 });
}

const labels={creation:'Occurrence created',edit:'Occurrence edited',cancellation:'Occurrence cancelled','creation-from-existing':'Created from existing occurrence'};
const fieldLabels={title:'Class title',instructor:'Instructor',location:'Location',category:'Category',capacity:'Capacity',duration:'Duration (minutes)',startsAt:'Start date and time',cancellationCutoffMinutes:'Cancellation cutoff (minutes)',creditRequired:'Requires a class credit',waitlistEnabled:'Waitlist enabled',requestId:'Request identity',records:'Supporting records',source:'Record source',id:'Record identity',value:'Recorded value'};
export function occurrenceHistoryHTML(data,occurrenceId,e){
 if(data?.context?.role!=='staff'||!data.classes?.some(c=>c.id===occurrenceId))return '';
 const events=occurrenceHistory(data,occurrenceId);
 const display=value=>Array.isArray(value)?`<ul>${value.map(v=>`<li>${display(v)}</li>`).join('')}</ul>`:value&&typeof value==='object'?`<dl>${Object.entries(value).map(([k,v])=>`<dt>${e(fieldLabels[k]||k)}</dt><dd>${display(v)}</dd>`).join('')}</dl>`:e(typeof value==='boolean'?(value?'Yes':'No'):String(value));
 const details=(title,value)=>`<details><summary>${e(title)}</summary>${display(value)}</details>`;
 return `<section class="card occurrence-history" aria-labelledby="occurrence-history-heading"><h2 id="occurrence-history-heading">Occurrence history</h2><p>Read-only recorded history for occurrence ${e(occurrenceId)}. Newest recorded time first; ties use event identity. Missing historical details are unrecorded. Current schedule details are shown separately above.</p><p>${events.length} recorded action${events.length===1?'':'s'}</p>${events.length?`<ol>${events.map(h=>`<li data-history-event="${e(h.type)}"><h3>${labels[h.type]}</h3><dl><dt>Recorded timestamp</dt><dd>${e(h.recordedAt)}</dd><dt>Actor</dt><dd>${e(h.actor.id)} · Role: ${e(h.actor.role)}</dd><dt>Event identity</dt><dd>${e(h.eventId)}</dd><dt>Occurrence identity</dt><dd>${e(h.occurrenceId)}</dd><dt>Reason</dt><dd>${e(h.reason)}</dd></dl>${details('Before',h.before)}${details('After',h.after)}${h.provenance!==missing?`<p>Source occurrence: ${e(h.provenance.sourceOccurrenceId)}. Historical provenance only; source and copy have independent histories.</p>${details('Recorded source snapshot',h.provenance.sourceDetails)}${details('Created occurrence snapshot',h.provenance.createdDetails)}`:''}${h.conflicts.length?`<p>Conflicting recorded evidence: ${e(h.conflicts.join(', '))}. A single value is unrecorded.</p>${details('Conflicting evidence',h.conflictingEvidence)}`:''}${details('Evidence references',{requestId:h.requestId,records:h.evidence})}</li>`).join('')}</ol>`:'<p>No recorded occurrence history. Creation details: unrecorded.</p>'}</section>`;
}
