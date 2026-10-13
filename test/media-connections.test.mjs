import test from 'node:test';
import assert from 'node:assert/strict';
import {beginMediaAuthorization,consumeMediaAuthorization,completeMediaAuthorization,disconnectMediaConnection,mediaConnectionView,requireMediaConnectionAuthority} from '../src/media-connections.mjs';
const actor={tenantId:'tenant',businessId:'business',userId:'owner',role:'staff'};
const row={tenantId:'tenant',businessId:'business',provider:'vimeo',revision:1,status:'disconnected'};
test('single-use authorization binds actor, business, browser, state and deadline',()=>{
 const started=beginMediaAuthorization(row,actor,1,0);
 const values={state:started.state,browser:started.browser};
 assert.equal(JSON.stringify(started.next).includes(started.state),false);
 for(const other of [{...actor,userId:'other'},{...actor,businessId:'other'},{...actor,tenantId:'other'}])assert.throws(()=>consumeMediaAuthorization(started.next,other,values,1));
 for(const key of ['state','browser'])assert.throws(()=>consumeMediaAuthorization(started.next,actor,{...values,[key]:'0'.repeat(64)},1));
 assert.throws(()=>consumeMediaAuthorization(started.next,actor,values,600000));
 const consumed=consumeMediaAuthorization(started.next,actor,values,1);
 assert.equal(consumed.pending,null);assert.throws(()=>consumeMediaAuthorization(consumed,actor,values,2));
});
test('disconnect fences in-flight authorization and projections exclude credentials',()=>{
 const started=beginMediaAuthorization(row,actor,1,0),verifying=consumeMediaAuthorization(started.next,actor,started,1);
 const input={sealedCredentials:'ciphertext',proof:{accountId:'/users/1',accountName:'Account',verifiedAt:new Date(1).toISOString(),sampleCount:0,capabilities:['account.read']},scopes:['public'],expiresAt:new Date(100).toISOString()};
 const connected=completeMediaAuthorization(verifying,actor,verifying.revision,input);
 assert.equal(mediaConnectionView(connected,100).status,'reconnect_required');
 assert.equal(JSON.stringify(mediaConnectionView(connected,1)).includes('ciphertext'),false);
 const disconnected=disconnectMediaConnection(verifying,actor,verifying.revision);
 assert.equal(disconnected.sealedCredentials,null);assert.equal(disconnected.pending,null);
 assert.throws(()=>completeMediaAuthorization(disconnected,actor,verifying.revision,input));
});
test('existing media-management role permissions apply; membership alone is insufficient',()=>{
 const state={staffRoleAssignments:[{...actor,role:'manager'}]};
 assert.doesNotThrow(()=>requireMediaConnectionAuthority(state,actor));
 for(const role of ['front_desk','instructor','unknown'])assert.throws(()=>requireMediaConnectionAuthority({staffRoleAssignments:[{...actor,role}]},actor));
 assert.throws(()=>requireMediaConnectionAuthority(state,{...actor,businessId:'other'}));
 assert.throws(()=>requireMediaConnectionAuthority(state,{...actor,role:'customer'}));
});
