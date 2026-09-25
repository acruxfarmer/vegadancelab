import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecoveryReader} from '../src/recovery-reader.mjs';
const auth={authorizationToken:'synthetic',apiInfo:{storageApi:{downloadUrl:'https://f001.backblazeb2.com',allowed:{buckets:[{id:'723a5face1abcc07a4080b1f'}],namePrefix:'vega-development/',capabilities:['readFiles']}}}};
test('reader uses only authorization and known-name GET with readFiles',async()=>{
 const calls=[],reader=await createRecoveryReader({keyId:'synthetic',key:'synthetic'},async(url,options)=>{calls.push(url);return url.endsWith('b2_authorize_account')?Response.json(auth):new Response('synthetic content');});
 assert.equal((await reader('vega-development/independent-discovery/v1/test.json')).toString(),'synthetic content');
 assert.equal(calls.length,2);assert.match(calls[1],/\/file\/vega-development-backups-acrux-20260920\/vega-development\//);
 await assert.rejects(reader('production/test.json'),/scope/);
});
test('only documented 404 not_found means absent; auth/transport failures never do',async()=>{
 for(const [status,body,absent] of [[404,{status:404,code:'not_found'},true],[404,{status:404,code:'unknown'},false],[401,{status:401,code:'unauthorized'},false],[503,{},false]]){
  const reader=await createRecoveryReader({keyId:'synthetic',key:'synthetic'},async url=>url.endsWith('b2_authorize_account')?Response.json(auth):Response.json(body,{status}));
  if(absent)assert.equal(await reader('vega-development/test.json'),null);else await assert.rejects(reader('vega-development/test.json'));
 }
});
test('broadened Restorer scopes are rejected',async()=>{
 const changed=structuredClone(auth);changed.apiInfo.storageApi.allowed.capabilities.push('listFiles');
 await assert.rejects(createRecoveryReader({keyId:'synthetic',key:'synthetic'},async()=>Response.json(changed)),/readFiles-only/);
});
