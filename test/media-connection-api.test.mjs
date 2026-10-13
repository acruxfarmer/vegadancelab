import test from 'node:test';
import assert from 'node:assert/strict';
import {handleMediaConnectionApi} from '../src/runtime/media-connection-api.mjs';
import {createMediaConnectionSecrets} from '../src/runtime/media-connection-secrets.mjs';
import {callbackContext,mediaConnectionOrigin,createConfiguredMediaConnections} from '../src/runtime/media-connection-configuration.mjs';
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status,headers){this.status=status;Object.assign(this.headers,headers);},end(){}};}
test('Google callback metadata is tolerated but never trusted or forwarded as authorization',async()=>{
 const secrets=createMediaConnectionSecrets('ab'.repeat(32)),identity={userId:'u',tenantId:'t',businessId:'b'};let received;
 const service={secrets,workflow:{complete:async(...args)=>{received=args;return {status:'connected'};}}};
 const binding={provider:'youtube',expiresAt:Date.now()+10000,identity,browser:'browser-proof'};
 const res=response();
 await handleMediaConnectionApi({url:'/api/media-connections/youtube/callback?code=one-code&state=one-state&scope=untrusted-scope&authuser=0&hd=example.test&prompt=consent',method:'GET',headers:{cookie:'vega_media_oauth_youtube='+secrets.seal(binding,callbackContext)}},res,{service});
 assert.equal(res.headers.Location,'/media-connections.html#connected');
 assert.deepEqual(received,[identity,'youtube',{state:'one-state',browser:'browser-proof',code:'one-code'}]);
 assert.equal(JSON.stringify(res.headers).includes('one-code'),false);
});
test('callback rejects duplicate parameters and unknown metadata before exchanging code',async()=>{
 const secrets=createMediaConnectionSecrets('ab'.repeat(32));let called=false;
 const service={secrets,workflow:{complete:async()=>{called=true;return {status:'connected'};}}};
 for(const [provider,suffix] of [['youtube','&state=second'],['youtube','&code=second'],['youtube','&scope=a&scope=b'],['youtube','&unknown=value'],['vimeo','&scope=public']]){
  const res=response(),binding={provider,expiresAt:Date.now()+10000};
  await handleMediaConnectionApi({url:`/api/media-connections/${provider}/callback?code=one&state=one${suffix}`,method:'GET',headers:{cookie:`vega_media_oauth_${provider}=`+secrets.seal(binding,callbackContext)}},res,{service});
  assert.equal(res.headers.Location,'/media-connections.html#authorization-incomplete');
 }
 assert.equal(called,false);
});
test('disabled and other-environment connection configuration fails closed',()=>{
 assert.equal(createConfiguredMediaConnections(null,{}),null);
 for(const env of [{VEGA_ENV:'production'},{VEGA_ENV:'development',RENDER_SERVICE_ID:'different'},{VEGA_ENV:'development',RENDER_SERVICE_ID:'srv-dao5cjbm8hqs73db51j0',VEGA_EXTERNAL_EFFECTS:'enabled'}])assert.throws(()=>createConfiguredMediaConnections(null,{VEGA_MEDIA_CONNECTIONS_ENABLED:'true',...env}));
});
test('begin cookie is HttpOnly and contains no raw provider credential',async()=>{
 const res=response(),secrets=createMediaConnectionSecrets('ab'.repeat(32));let sent;
 const workflow={begin:async()=>({authorizationUrl:'https://api.vimeo.com/oauth/authorize?state=test',browser:'a'.repeat(64)})};
 await handleMediaConnectionApi({url:'/api/media-connections/vimeo/begin',method:'POST',headers:{origin:mediaConnectionOrigin}},res,{service:{workflow,secrets},principal:async()=>({userId:'u',tenantId:'t',businessId:'b'}),readJson:async()=>({expectedRevision:1}),send:(status,value)=>{sent=value;}});
 assert.deepEqual(Object.keys(sent),['authorizationUrl']);assert.match(res.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
});
test('cross-origin mutations and unscoped authority are denied before operation',async()=>{
 let called=false;const deps={service:{workflow:{begin:async()=>{called=true;}}},principal:async()=>({userId:'u',tenantId:'t',businessId:'b'}),readJson:async()=>({expectedRevision:1}),send(){}};
 await assert.rejects(handleMediaConnectionApi({url:'/api/media-connections/vimeo/begin',method:'POST',headers:{origin:'https://other.test'}},response(),deps));
 assert.equal(called,false);
 await assert.rejects(handleMediaConnectionApi({url:'/api/media-connections/vimeo',method:'GET',headers:{}},response(),{...deps,principal:async()=>'u'}));
});
test('callback rejects missing, expired or wrong-provider binding without echoing query',async()=>{
 const secrets=createMediaConnectionSecrets('ab'.repeat(32));let called=false;
 const service={secrets,workflow:{complete:async()=>{called=true;}}};
 for(const binding of [null,{provider:'vimeo',expiresAt:1},{provider:'youtube',expiresAt:Date.now()+10000}]){
  const res=response();await handleMediaConnectionApi({url:'/api/media-connections/vimeo/callback?code=secret-code&state=state',method:'GET',headers:binding?{cookie:'vega_media_oauth_vimeo='+secrets.seal(binding,callbackContext)}:{}},res,{service});
  assert.equal(res.status,303);assert.equal(res.headers.Location,'/media-connections.html#authorization-incomplete');assert.equal(JSON.stringify(res.headers).includes('secret-code'),false);
 }
 assert.equal(called,false);
});
