import assert from 'node:assert/strict';
const origin='https://vega-development-web.onrender.com';
const get=async(path,headers={})=>{const r=await fetch(origin+path,{headers,signal:AbortSignal.timeout(30000)});return {status:r.status,body:await r.json()};};
const v=await get('/api/public/studios/vega'),w=await get('/api/public/studios/willow');
assert.equal(v.status,200);assert.equal(w.status,200);
assert.equal(v.body.studio.name,'Vega Dance Lab');assert.equal(w.body.studio.name,'Willow Movement');
assert.equal(v.body.classes.length,3);assert.equal(w.body.classes.length,3);
assert.equal(v.body.classes.find(c=>c.id==='f577b7b9-2243-4316-9e73-5fe40ea4757f').availability,'cancelled');
assert.equal(w.body.classes.find(c=>c.id==='willow-full').availability,'full');
assert.equal(v.body.offers[0].priceMinor,6000);assert.equal(w.body.offers.length,0);
assert.equal(v.body.classes.find(c=>c.id==='ced0dba0-316b-4168-a3f1-f16d6fa43819').creditRequired,true);
for(const x of [v.body,w.body]){
 assert.doesNotMatch(JSON.stringify(x),/participantId|purchaseDrafts|refundHistory|attendance|customerProfiles|staffAccess|contactEmail|accountId|reservedCount|capacity/);
 assert.ok(x.classes.every(c=>Date.parse(c.startsAt)>Date.now()));
}
const forged=await get('/api/public/studios/vega',{'X-Vega-Tenant':'layer3-reuse-fixture','X-Vega-Business':'willow-movement'});
assert.equal(forged.body.studio.slug,'vega');assert.deepEqual(forged.body.classes,v.body.classes);
for(const path of ['/api/app','/api/profile','/api/memberships'])assert.equal((await get(path)).status,401);
assert.equal((await get('/api/public/studios/not-published')).status,404);
assert.equal((await get('/api/public/studios/vega?business=willow')).status,404);
console.log(JSON.stringify({verifiedAt:new Date().toISOString(),origin,anonymousBrowse:true,twoStudios:true,currentSchedule:true,cancelledAndFull:true,sourceOfferPrice:6000,privateRoutesRequireAuth:true,forgedBusinessHeadersIgnored:true,allowlistNoPrivateFields:true,missingStudio404:true},null,2));
