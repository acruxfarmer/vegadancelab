import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalTerms,rentalStatus,readRentalPolicy} from '../public/rental-ui.js';
import {rentalManagement} from '../public/rental-management.js';
const e=s=>String(s??'').replace(/[<>]/g,c=>c==='<'?'&lt;':'&gt;');
test('rental terms show advance purchase, first primary playback and ordinary expiration without continuation promises',()=>{const html=rentalTerms({activationDays:30,viewingHours:48,replayAllowed:false,releaseAt:'2026-10-10T12:00:00Z'},e);for(const text of ['30 days','48 hours','first video playback','One viewing session','No new playback','Scheduled availability'])assert.ok(html.includes(text));assert.ok(!html.includes('permanent'));});
test('rental customer status escapes adjustment messages and separates suspension from expiration',()=>{const html=rentalStatus({status:'active',availability:'suspended',expiresAt:'2026-10-11T12:00:00Z',adjustments:[{action:'extend',at:'2026-10-09T12:00:00Z',customerMessage:'<script>unsafe</script>',reason:'private staff rationale'}]},e);assert.match(html,/Active/);assert.match(html,/temporarily suspended/);assert.match(html,/Viewing expires/);assert.ok(!html.includes('<script>'));assert.ok(!html.includes('private staff rationale'));});
test('manager sees extension only while owner corrections and pricing require server authority',()=>{const p={id:'p',rental:{canExtend:true,entitlements:[{id:'e',revision:3,principalId:'u',status:'active'}]}};const html=rentalManagement(p,e);assert.match(html,/Extend viewing time/);for(const text of ['Rental offer','Reset activation','Grant complimentary access','Revoke access','Availability<select'])assert.ok(!html.includes(text));});
test('owner sees versioned offer and withdrawal controls with reason and immutable quote notice',()=>{const html=rentalManagement({id:'p',rental:{canConfigure:true,canCorrect:true,availability:'published'},commerce:{current:{title:'A video',priceMinor:500,currency:'USD'}}},e);for(const text of ['Save new offer version','valid checkout quotes','Mandatory withdrawal','Reason','Grant complimentary access'])assert.ok(html.includes(text));});
test('rental form parser preserves unchecked replay and explicit numeric policy',()=>{const f=new Map([['activationDays','30'],['viewingHours','48'],['releaseAt','']]);assert.deepEqual(readRentalPolicy(f),{activationDays:30,viewingHours:48,replayAllowed:false,releaseAt:null});});

test('retired grace data cannot surface settings, finish deadlines, or customer promises',()=>{
 const legacy={activationDays:30,viewingHours:48,graceCapHours:4,graceBufferMinutes:10},terms=rentalTerms(legacy,e),status=rentalStatus({status:'active',deadlineAt:'2099-01-01T00:00:00Z'},e),html=rentalManagement({id:'p',rental:{canConfigure:true},commerce:{current:{title:'Video',priceMinor:100,currency:'USD',rentalPolicy:legacy}}},e);
 for(const text of [terms,status,html])assert.ok(!/grace|finish deadline|Finish this session|graceBufferMinutes|graceCapHours/i.test(text));
 assert.ok(!status.includes('2099'));assert.match(terms,/Access expires at the displayed date and time/);
});
