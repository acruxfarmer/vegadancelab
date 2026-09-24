import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createDevelopmentServer} from '../src/runtime/web.mjs';

test('fresh local runtime serves all front-door assets with security headers and fail-closed API',async()=>{
 const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const origin=`http://127.0.0.1:${server.address().port}`;
 try{
  for(const [path,type] of [['/','text/html'],['/app.js','text/javascript'],['/integration.js','text/javascript'],['/session.js','text/javascript'],['/cancellation-ui.js','text/javascript'],['/entitlements-ui.js','text/javascript'],['/styles.css','text/css']]){
   const response=await fetch(`${origin}${path}`);assert.equal(response.status,200,path);
   assert.ok(response.headers.get('content-type').startsWith(type));
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.equal(response.headers.get('x-content-type-options'),'nosniff');
   assert.equal(response.headers.get('referrer-policy'),'no-referrer');
   assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
   assert.ok((await response.text()).length>0);
  }
  const config=await fetch(`${origin}/api/config`);assert.equal(config.status,200);
  const classCancel=await fetch(`${origin}/class-cancellation-ui.js`);assert.equal(classCancel.status,200);assert.match(await classCancel.text(),/export function classCancellationUI/);
  const classEdit=await fetch(`${origin}/class-editing-ui.js`);assert.equal(classEdit.status,200);assert.match(await classEdit.text(),/export function classEditingUI/);
  const waitlist=await fetch(`${origin}/staff-waitlist.js`);assert.equal(waitlist.status,200);assert.match(await waitlist.text(),/export function staffWaitlistUI/);
  const attendance=await fetch(`${origin}/attendance-ui.js`);assert.equal(attendance.status,200);assert.match(attendance.headers.get('content-type'),/text\/javascript/);assert.match(await attendance.text(),/export function attendanceUI/);
  const roster=await fetch(`${origin}/roster-navigation.js`);assert.equal(roster.status,200);assert.match(roster.headers.get('content-type'),/text\/javascript/);assert.match(await roster.text(),/export function rosterResults/);
  const history=await fetch(`${origin}/reservation-history.js`);assert.equal(history.status,200);assert.match(history.headers.get('content-type'),/text\/javascript/);assert.match(await history.text(),/export function reservationHistory/);
  const notices=await fetch(`${origin}/promotion-notices.js`);assert.equal(notices.status,200);assert.match(notices.headers.get('content-type'),/text\/javascript/);assert.match(await notices.text(),/export function promotionNoticesHTML/);
  assert.equal((await config.json()).squareEnabled,false);
  for(const path of ['/api/app','/health/ready','/health/ingestion']){
   const response=await fetch(`${origin}${path}`);assert.equal(response.status,503,path);
  }
  const signin=await fetch(`${origin}/api/auth/sign-in`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'synthetic@example.invalid',password:'synthetic'})});
  assert.equal(signin.status,503);
  const traversal=await fetch(`${origin}/%2e%2e/package.json`);assert.notEqual(traversal.status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
