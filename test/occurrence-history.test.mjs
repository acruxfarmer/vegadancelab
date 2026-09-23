import test from 'node:test';
import assert from 'node:assert/strict';
import {occurrenceHistory,occurrenceHistoryHTML,occurrenceHistoryTypes} from '../public/occurrence-history.js';
const at='2026-09-23T12:00:00Z';
const fixture=()=>({context:{role:'staff'},classes:[{id:'source',title:'CURRENT',editHistory:[{id:'e',actorId:'staff',createdAt:at,before:{title:'Before'},after:{title:'After'},reason:'Correction'}],cancellationHistory:[{id:'x',actorId:'staff',createdAt:'2026-09-24T12:00:00Z',reason:'Closed'}]},{id:'copy',creationProvenance:{id:'p',classId:'copy',sourceClassId:'source',actorId:'staff',actorRole:'staff',createdAt:at,sourceDetails:{title:'After'},details:{title:'Independent'}}}],activity:[{id:'create',action:'class',subjectId:'source',actorId:'staff',createdAt:at},{id:'ea',action:'edit-class',subjectId:'source',classEditEventId:'e',actorId:'staff',createdAt:at},{id:'xa',action:'cancel-class',subjectId:'source',classCancellationEventId:'x',createdAt:'2026-09-24T12:00:00Z'},{id:'p',action:'class',subjectId:'copy',creationProvenanceId:'p',sourceClassId:'source',actorId:'staff',createdAt:at}]});
test('linked evidence yields one action, bounded contract, independent source and copy, immutable projection',()=>{
 const d=fixture(),before=structuredClone(d),events=occurrenceHistory(d,'source'),copy=occurrenceHistory(d,'copy');
 assert.equal(events.length,3);assert.equal(copy.length,1);assert.equal(copy[0].type,'creation-from-existing');assert.equal(copy[0].provenance.sourceOccurrenceId,'source');assert.equal(copy[0].evidence.length,2);
 assert.equal(events.find(h=>h.type==='edit').evidence.length,2);assert.equal(events.find(h=>h.type==='edit').before.title,'Before');assert.equal(events.find(h=>h.type==='creation').after,'unrecorded');assert.equal(events.find(h=>h.type==='creation').actor.role,'unrecorded');assert.equal(events[0].before,'unrecorded');
 for(const e of [...events,...copy]){assert.equal(e.contractVersion,1);assert.ok(occurrenceHistoryTypes.includes(e.type));assert.ok(e.actor.id);assert.ok(e.recordedAt);assert.ok(e.occurrenceId);}
 assert.deepEqual(d,before);copy[0].provenance.createdDetails.title='mutated projection';assert.deepEqual(d,before);
 d.classes[0].title='changed current';assert.deepEqual(occurrenceHistory(d,'source'),events);
});
test('ordering is deterministic across input order and linked evidence duplicates',()=>{
 const d=fixture(),expected=occurrenceHistory(d,'source');d.activity.push(structuredClone(d.activity[1]));d.classes[0].editHistory.push(structuredClone(d.classes[0].editHistory[0]));d.activity.reverse();d.classes.reverse();
 assert.deepEqual(occurrenceHistory(d,'source'),expected);assert.equal(expected[0].type,'cancellation');
});
test('same timestamp never merges distinct actions; missing IDs preserve anonymous actions',()=>{
 const d=fixture();d.classes[0].editHistory.push({id:'e2',createdAt:at},{reason:'legacy'},{reason:'legacy'});
 const h=occurrenceHistory(d,'source');assert.equal(h.filter(h=>h.type==='edit').length,4);assert.equal(new Set(h.map(h=>h.key)).size,h.length);assert.equal(h.at(-1).recordedAt,'unrecorded');assert.equal(h.at(-1).eventId,'unrecorded');
});
test('legacy gaps and activity-only evidence are explicit; unrelated audit categories excluded',()=>{
 const d={context:{role:'staff'},classes:[{id:'legacy',status:'cancelled',startsAt:'2000-01-01',title:'Do not infer'}],activity:[]};assert.deepEqual(occurrenceHistory(d,'legacy'),[]);
 d.activity.push({id:'e',action:'edit-class',subjectId:'legacy',classEditEventId:'lost'},{id:'other',action:'reserve',subjectId:'legacy'});
 const [h]=occurrenceHistory(d,'legacy');assert.equal(h.eventId,'lost');assert.equal(h.before,'unrecorded');assert.equal(h.after,'unrecorded');assert.deepEqual(h.actor,{id:'unrecorded',role:'unrecorded'});assert.equal(h.recordedAt,'unrecorded');
});
test('contradictory evidence is preserved and flagged instead of selecting a historical value',()=>{
 const d=fixture();d.activity[1].actorId='other';const h=occurrenceHistory(d,'source').find(h=>h.type==='edit');assert.equal(h.actor.id,'unrecorded');assert.deepEqual(h.conflicts,['actorId']);assert.deepEqual(new Set(h.conflictingEvidence.actorId.map(e=>e.value)),new Set(['staff','other']));
});
test('staff scoped occurrence lookup and escaped read-only HTML',()=>{
 const d=fixture(),escape=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
 d.classes[0].editHistory[0].reason='<img src=x onerror=alert(1)>';const html=occurrenceHistoryHTML(d,'source',escape);assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<button'));assert.ok(html.includes('Before'));assert.equal(occurrenceHistoryHTML(d,'foreign',escape),'');assert.deepEqual(occurrenceHistory(d,'foreign'),[]);
 for(const role of ['member',undefined]){d.context.role=role;assert.deepEqual(occurrenceHistory(d,'source'),[]);assert.equal(occurrenceHistoryHTML(d,'source',escape),'');}
});
