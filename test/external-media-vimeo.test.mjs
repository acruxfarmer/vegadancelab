import test from 'node:test';
import assert from 'node:assert/strict';
import {createVimeoConnectionAdapter} from '../src/runtime/providers/external-media-vimeo.mjs';
const config={clientId:'test-client',clientSecret:'test-secret',redirectUri:'https://vega-development-web.onrender.com/api/media-connections/vimeo/callback',now:()=>100000};
const json=value=>new Response(JSON.stringify(value));
test('Vimeo revocation confirms only no-content success or an already-invalid credential',async()=>{
 for(const status of [204,401]){
  const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>new Response(null,{status})});
  await adapter.revoke({accessToken:'test-token'});
 }
 const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>json({unexpected:'response'})});
 await assert.rejects(adapter.revoke({accessToken:'test-token'}),/provider_response_invalid/);
});
test('Vimeo authorization is read-only with fixed redirect and caller-bound state',()=>{
 const url=new URL(createVimeoConnectionAdapter(config).authorizationUrl('a'.repeat(64)));
 assert.equal(url.searchParams.get('scope'),'public');assert.equal(url.searchParams.get('state'),'a'.repeat(64));assert.equal(url.searchParams.get('redirect_uri'),config.redirectUri);
 assert.throws(()=>createVimeoConnectionAdapter({...config,redirectUri:'https://elsewhere.test'}),/provider_not_configured/);
});
test('real transport contract exchanges code and returns only account and bounded count',async()=>{
 const calls=[],responses=[{access_token:'provider-token',token_type:'bearer',scope:'public'},{uri:'/users/123',name:'Business'},{data:[{uri:'/videos/7'}]}];
 const adapter=createVimeoConnectionAdapter({...config,fetcher:async(url,options)=>{calls.push({url,options});return json(responses.shift());}});
 const credentials=await adapter.exchange('one-time-code');const proof=await adapter.verify(credentials);
 assert.equal(proof.sampleCount,1);assert.equal(proof.accountId,'/users/123');assert.equal(JSON.stringify(proof).includes('/videos/7'),false);assert.equal(JSON.stringify(proof).includes('provider-token'),false);
 assert.equal(calls.length,3);assert.equal(calls[2].url,'https://api.vimeo.com/me/videos?per_page=2&page=1&fields=uri');assert.equal(calls[0].options.redirect,'error');
});
test('empty media list is valid authorization proof, not a playback claim',async()=>{
 const responses=[{uri:'/users/123',name:'Business'},{data:[]}];
 const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>json(responses.shift())});
 assert.equal((await adapter.verify({accessToken:'test-token',scopes:['public']})).sampleCount,0);
});
test('broader grants and expired credentials fail closed',async()=>{
 const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>json({access_token:'secret',token_type:'bearer',scope:'public upload'})});
 await assert.rejects(adapter.exchange('code'),/scope_mismatch/);
 await assert.rejects(adapter.verify({accessToken:'secret',scopes:['public'],expiresAt:new Date(99999).toISOString()}),/reconnect_required/);
});
test('provider errors are categorized without reflecting provider secrets',async()=>{
 for(const [status,code] of [[401,'reconnect_required'],[403,'permission_denied'],[429,'rate_limited'],[500,'provider_unavailable']]){
  const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>new Response('secret-token',{status})});
  await assert.rejects(adapter.verify({accessToken:'secret',scopes:['public']}),error=>error.message===code&&!error.message.includes('secret'));
 }
});
test('oversized sample and malformed identity are rejected',async()=>{
 for(const responses of [[{uri:'https://attacker.test',name:'bad'}],[{uri:'/users/1',name:'Business'},{data:[{uri:'/videos/1'},{uri:'/videos/2'},{uri:'/videos/3'}]}]]){
  const adapter=createVimeoConnectionAdapter({...config,fetcher:async()=>json(responses.shift())});
  await assert.rejects(adapter.verify({accessToken:'test',scopes:['public']}),/provider_response_invalid/);
 }
});
