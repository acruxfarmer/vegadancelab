import test from 'node:test';
import assert from 'node:assert/strict';
import {createMediaConnectionSecrets} from '../src/runtime/media-connection-secrets.mjs';
const context={tenantId:'tenant-a',businessId:'business-a',provider:'vimeo',purpose:'credentials'};
test('connection secrets authenticate business, provider and purpose and use fresh nonces',()=>{
 const vault=createMediaConnectionSecrets('ab'.repeat(32)),secret={accessToken:'not-for-browser'};
 const first=vault.seal(secret,context),second=vault.seal(secret,context);
 assert.notEqual(first,second);assert.equal(first.includes(secret.accessToken),false);assert.deepEqual(vault.open(first,context),secret);
 for(const field of Object.keys(context))assert.throws(()=>vault.open(first,{...context,[field]:'different'}),/credential_unavailable/);
 assert.throws(()=>createMediaConnectionSecrets('cd'.repeat(32)).open(first,context),/credential_unavailable/);
});
test('missing keys and damaged envelopes fail closed without leaking contents',()=>{
 assert.throws(()=>createMediaConnectionSecrets(),/credential_storage_not_configured/);
 const vault=createMediaConnectionSecrets('ab'.repeat(32));
 for(const value of ['',null,'v1.bad.bad.secret','x'.repeat(32769)])assert.throws(()=>vault.open(value,context),/credential_unavailable/);
});
