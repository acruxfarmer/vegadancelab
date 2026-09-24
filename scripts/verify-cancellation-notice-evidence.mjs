import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const base=new URL('../docs/cancellation-notice-local/',import.meta.url);
const read=async name=>JSON.parse(await readFile(new URL(name,base),'utf8'));
const before=await read('before.json'),after=await read('after.json'),{cmd,result}=await read('last-command.json');
assert.equal(cmd.action,'cancel-class');assert.equal(after.revision,before.revision+1);
const notices=after.notifications.filter(n=>n.type==='occurrence-cancellation');assert.equal(notices.length,2);assert.equal(new Set(notices.map(n=>n.id)).size,2);assert.deepEqual(result.noticeIds,notices.map(n=>n.id));
assert.deepEqual(after.notifications.filter(n=>n.type==='waitlist-promotion'),before.notifications);
for(const r of before.reservations.filter(r=>r.status==='cancelled'))assert.deepEqual(after.reservations.find(x=>x.id===r.id),r);
assert.deepEqual(notices.map(n=>n.creditSnapshot.outcome).sort(),['not_applicable','restored']);assert.doesNotMatch(JSON.stringify(notices),/PRIVATE ADMIN NOTE/);
for(const n of notices){assert.equal(n.cancellationEventId,result.eventId);assert.equal(n.occurrenceId,cmd.body.classId);assert.equal(n.participantId,after.reservations.find(r=>r.id===n.reservationId).participantId);assert.equal(n.deliveryStatus,'disabled');}
assert.equal(after.creditEvents.length,before.creditEvents.length+1);
const report={status:'passed',scope:'Local synthetic loopback only',revisionBefore:before.revision,revisionAfter:after.revision,newNotices:2,promotionNoticesUnchanged:true,previouslyCancelledUnchanged:true,restoredCredits:1,noticeIds:notices.map(n=>n.id),browserChecks:['Staff review: 1 booked, 1 waiting, 1 expected restoration, 2 notices','Staff confirmation and member account agree on participant-specific outcome','Member sees only own cancellation notice plus preserved promotion notice','Member reload: identical notice text and identities','No internal cancellation reason in member main or notice payload','Staff and member mobile 390x844: expanded IDs wrap, no horizontal overflow; screenshots inspected','Member desktop 1440x1050: both notice types visually inspected','Browser warning/error log empty; viewport reset'],limitations:['Synthetic authority fixture; hosted deployment and positive hosted mutation verification not performed','Prior hosted staff-mobile/isolation/DST and retained-fixture coverage limitations remain']};
await writeFile(new URL('verification.json',base),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
