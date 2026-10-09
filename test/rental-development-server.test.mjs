import test from 'node:test';
import assert from 'node:assert/strict';
import {createDevelopmentServer} from '../src/runtime/refund-web.mjs';
import {once} from 'node:events';
test('actual Development server serves rental modules and keeps unauthenticated playback and payments disabled',async()=>{
 const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled',SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'test'},null,null,null);
 server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 try{
  for(const file of ['watch.html','watch.js','rental-ui.js','rental-management.js','manage-media.js','acrux-player.js']){const r=await fetch(base+'/'+file);assert.equal(r.status,200,file);assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok((await r.text()).length>0);}
  const config=await (await fetch(base+'/api/config')).json();assert.equal(config.paymentMode,'disabled');assert.equal(config.squareEnabled,false);assert.equal(config.externalEffects,'disabled');
  const r=await fetch(base+'/api/media/placements/11111111-1111-4111-8111-111111111111/rental/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:'unauthenticated'})});assert.equal(r.status,401);
 }finally{await new Promise(r=>server.close(r));}
});
