import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDevelopmentServer} from '../src/runtime/web.mjs';

test('fresh local runtime serves all front-door assets with security headers and fail-closed API',async()=>{
 const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/integration.js','text/javascript'],['/session.js','text/javascript'],['/styles.css','text/css']]){
   const response=await fetch(`${origin}${path}`);assert.equal(response.status,200,path);
   assert.ok(response.headers.get('content-type').startsWith(type));
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
   assert.ok((await response.text()).length>0);
  }
  const config=await fetch(`${origin}/api/config`);assert.equal(config.status,200);
  assert.equal((await config.json()).squareEnabled,false);
  for(const path of ['/api/app','/health/ready','/health/ingestion']){
   const response=await fetch(`${origin}${path}`);assert.equal(response.status,503,path);
  }
  const signin=await fetch(`${origin}/api/auth/sign-in`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',password:'synthetic'})});
  assert.equal(signin.status,503);
  const traversal=await fetch(`${origin}/%2e%2e/package.json`);assert.notEqual(traversal.status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
