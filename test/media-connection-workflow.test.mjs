import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaConnectionWorkflow} from '../src/runtime/media-connection-workflow.mjs';
import {createMediaConnectionSecrets} from '../src/runtime/media-connection-secrets.mjs';
const identity={tenantId:'tenant',businessId:'business',userId:'owner'};
function fixture(){
 let row={...identity,provider:'vimeo',status:'disconnected',revision:1},denied=false;
 const events=[],calls=[];
 const repository={async transaction(actor,provider,operation){if(denied||actor.businessId!==identity.businessId)throw Error('denied');const result=await operation(structuredClone(row),{...actor,role:'staff'});if(result.next){row=result.next;events.push(result.action);}return result.value;}};
 const adapter={authorizationUrl:state=>'https://provider.test/?state='+state,async exchange(){calls.push('exchange');return {accessToken:'secret',scopes:['public'],expiresAt:null};},async verify(){calls.push('verify');return {accountId:'account',accountName:'Account',verifiedAt:new Date(1).toISOString(),sampleCount:2,capabilities:['account.read','media.sample.read']};},async revoke(){assert.equal(row.status,'disconnected');assert.equal(row.sealedCredentials,null);calls.push('revoke');}};
 const workflow=createMediaConnectionWorkflow({repository,secrets:createMediaConnectionSecrets('ab'.repeat(32)),adapters:{vimeo:adapter},now:()=>1});
 return {workflow,adapter,events,calls,get:()=>row,deny:()=>{denied=true;}};
}
test('connection lifecycle persists ciphertext and safe audit actions, not discovered media',async()=>{
 const f=fixture(),start=await f.workflow.begin(identity,'vimeo',1);
 const connected=await f.workflow.complete(identity,'vimeo',{...start,code:'code'});
 assert.equal(connected.status,'connected');assert.equal(connected.sampleCount,2);assert.equal(JSON.stringify(connected).includes('secret'),false);
 assert.ok(f.get().sealedCredentials);assert.equal(JSON.stringify(f.get()).includes('secret'),false);
 const checked=await f.workflow.verify(identity,'vimeo',connected.revision);
 const disconnected=await f.workflow.disconnect(identity,'vimeo',checked.revision);
 assert.equal(disconnected.status,'disconnected');assert.equal(disconnected.revocation,'confirmed');
 await assert.rejects(f.workflow.verify(identity,'vimeo',disconnected.revision));
 assert.deepEqual(f.calls,['exchange','verify','verify','revoke']);
 assert.deepEqual(f.events,['authorization_started','authorization_consumed','credentials_saved','connection_verified','connection_verified','disconnected','revocation_recorded']);
});
test('provider revocation failure still prevents all subsequent reads',async()=>{
 const f=fixture(),start=await f.workflow.begin(identity,'vimeo',1),connected=await f.workflow.complete(identity,'vimeo',{...start,code:'code'});
 f.adapter.revoke=async()=>{throw Error('secret provider error');};
 const result=await f.workflow.disconnect(identity,'vimeo',connected.revision);
 assert.equal(result.status,'disconnected');assert.equal(result.revocation,'unconfirmed');assert.equal(f.get().sealedCredentials,null);
 await assert.rejects(f.workflow.verify(identity,'vimeo',result.revision));
});
test('revoked business permission prevents token exchange at callback',async()=>{
 const f=fixture(),start=await f.workflow.begin(identity,'vimeo',1);f.deny();
 await assert.rejects(f.workflow.complete(identity,'vimeo',{...start,code:'code'}));assert.deepEqual(f.calls,[]);
});
test('callback replay does not exchange code twice',async()=>{
 const f=fixture(),start=await f.workflow.begin(identity,'vimeo',1);await f.workflow.complete(identity,'vimeo',{...start,code:'code'});
 await assert.rejects(f.workflow.complete(identity,'vimeo',{...start,code:'code'}));assert.deepEqual(f.calls,['exchange','verify']);
});
test('verification errors do not leak provider text or grant a connected status',async()=>{
 const f=fixture(),start=await f.workflow.begin(identity,'vimeo',1);f.adapter.verify=async()=>{throw Object.assign(Error('token=secret'),{code:'permission_denied'});};
 const result=await f.workflow.complete(identity,'vimeo',{...start,code:'code'});
 assert.equal(result.status,'unavailable');assert.equal(result.lastError,'permission_denied');assert.equal(JSON.stringify(result).includes('secret'),false);
});
