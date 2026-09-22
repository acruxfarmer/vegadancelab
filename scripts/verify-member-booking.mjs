import {chromium} from 'file:///C:/Users/Joe%20Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {emptyState,transition,visibleState} from '../src/application.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const output=new URL('../docs/member-booking-local/',import.meta.url);await mkdir(output,{recursive:true});
const member={role:'member',userId:'member-test',participantIds:['p','child']},staff={role:'staff',userId:'staff-test',participantIds:[]};
const startsAt=new Date(Date.now()+3*86400000).toISOString();
let state={...emptyState(),participants:[{id:'p',name:'Member Test'},{id:'child',name:'Authorized Child'},{id:'private',name:'PRIVATE OTHER MEMBER'}],classes:['Eligible class','No eligible credit','Full class','Late cancellation','Free class','Last seat'].map((title,i)=>({id:`c${i}`,title,category:i===1?'Other':'Dance',status:'open',startsAt,duration:60,instructor:'Development Instructor',location:'Development Studio',capacity:1,creditRequired:i!==4,cancellationCutoffMinutes:i===3?10080:90,waitlistEnabled:i===2})),reservations:[{id:'private-booking',participantId:'private',classId:'c2',status:'reserved',attendanceStatus:'not_recorded'}]};
let n=0;function command(action,body,id,actor=staff){const next=transition(state,{action,id,body:{requestId:`fixture-${++n}`,...body}},actor);state=next.state;return next.result;}
const product=command('entitlement-product',{name:'Member Dance Pack',type:'class_pack',quantity:4,validDays:30,categories:['Dance']});command('issue-entitlement',{productId:product.id,participantId:'p',issuanceRef:'local-booking-test',reason:'Synthetic local verification'});
command('issue-entitlement',{productId:product.id,participantId:'private',issuanceRef:'local-other-member',reason:'Synthetic capacity competitor'});
const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
const report={scope:'Local browser with synthetic identity/state and real domain transitions; no hosted database or provider effects',checks:[],errors:[]};
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',error=>report.errors.push(error.message));
 const cache=new Map();let loseResponse=true,failRead=false;
 await page.route('**/api/**',async route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  let result,status=200;
  try{
   if(path.startsWith('/api/auth/'))result={accessToken:'local-test',refreshToken:'local-refresh',expiresIn:3600};
   else if(path==='/api/app'){if(failRead){failRead=false;throw new Error('Temporary refresh failure')}result={...visibleState(state,member),context:member,mode:'development',jobs:[]};}
   else {
    const body=request.postDataJSON(),match=path.match(/\/reservations\/([^/]+)\/cancel/),action=match?'cancel':'reserve';
    const fingerprint=JSON.stringify([path,body]),prior=cache.get(body.requestId);
    if(prior){assert.equal(prior.fingerprint,fingerprint);result=prior.result;}
    else {result=command(action,body,match?.[1],member);cache.set(body.requestId,{fingerprint,result});}
    if(action==='reserve'&&loseResponse){loseResponse=false;await route.abort('failed');return;}
   }
  }catch(error){status=error.status||503;result={error:error.message};}
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 const base=`http://127.0.0.1:${server.address().port}`;await page.goto(base);await page.locator('#login [name=email]').fill('local@example.invalid');await page.locator('#login [name=password]').fill('synthetic');await page.locator('#login button').click();await page.getByRole('heading',{name:'Your upcoming activity'}).waitFor();
 await page.getByRole('link',{name:'Classes',exact:true}).click();
 async function open(title){await page.locator('article.card').filter({has:page.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'View class'}).click();await page.locator('#member-booking').waitFor();}
 await open('Eligible class');assert.match(await page.getByRole('dialog').innerText(),/Use 1 credit from Member Dance Pack/);
 await page.locator('#member-booking select').selectOption('child');assert.equal(await page.getByRole('button',{name:'Confirm booking'}).isDisabled(),true);await page.locator('#member-booking select').selectOption('p');
 await page.getByRole('button',{name:'Confirm booking'}).click();await page.locator('#member-booking-error').filter({hasText:'Refresh the schedule'}).waitFor();
 await page.getByRole('button',{name:'Confirm booking'}).click();await page.getByRole('heading',{name:'Booking confirmed'}).waitFor();assert.equal(state.creditEvents.filter(e=>e.type==='consume').length,1);report.checks.push('Pre-confirmation pass/participant eligibility; lost POST response retries same request and consumes exactly once');
 await page.getByRole('button',{name:'View my bookings'}).click();await page.getByRole('heading',{name:'Upcoming',exact:true}).waitFor();
 await page.reload();await page.getByRole('heading',{name:'My bookings'}).waitFor();assert.equal(await page.locator('[data-cancel]').count(),1);report.checks.push('Confirmed booking persists through browser refresh');
 await page.getByRole('link',{name:'Classes',exact:true}).click();await open('Eligible class');assert.equal(await page.getByRole('button',{name:'Confirm booking'}).isDisabled(),true);assert.match(await page.getByRole('dialog').innerText(),/already have a booking/);await page.keyboard.press('Escape');
 for(const title of ['No eligible credit','Full class']){await open(title);assert.equal(await page.getByRole('button',{name:'Confirm booking'}).isDisabled(),true);assert.doesNotMatch(await page.getByRole('dialog').innerText(),/Join waitlist/);await page.keyboard.press('Escape');}report.checks.push('Duplicate, restricted entitlement and capacity rejected before confirmation; no waitlist action');
 await page.getByRole('link',{name:'My bookings',exact:true}).click();await page.locator('[data-cancel]').click();await page.locator('[data-confirm-cancel]').dblclick();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(state.creditEvents.filter(e=>e.type==='restore').length,1);await page.reload();await page.getByRole('heading',{name:'My bookings'}).waitFor();assert.match(await page.locator('main').innerText(),/4 unspent credits/);report.checks.push('Repeated cancellation restores once; refreshed booking and credit state agree');
 await page.getByRole('link',{name:'Classes',exact:true}).click();await open('Late cancellation');await page.getByRole('button',{name:'Confirm booking'}).click();await page.getByRole('button',{name:'View my bookings'}).click();await page.locator('[data-cancel]').click();await page.locator('[data-confirm-cancel]').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(state.creditEvents.filter(e=>e.type==='restore').length,1);assert.match(await page.locator('main').innerText(),/3 unspent credits/);report.checks.push('Late member cancellation retains debit under verified cutoff rule');
 await page.getByRole('link',{name:'Classes',exact:true}).click();await open('Last seat');command('reserve',{classId:'c5',participantId:'private'},undefined,staff);await page.getByRole('button',{name:'Confirm booking'}).click();await page.locator('#member-booking-error').filter({hasText:'Class full'}).waitFor();assert.equal(state.reservations.filter(r=>r.classId==='c5').length,1);await page.keyboard.press('Escape');report.checks.push('Capacity lost after preflight is rechecked at confirmation without member debit');
 assert.doesNotMatch(await page.locator('body').innerText(),/PRIVATE OTHER MEMBER|Issue manual|Provision entitlement|Processing/);
 await page.screenshot({path:fileURLToPath(new URL('desktop-schedule.png',output)),fullPage:true});await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:fileURLToPath(new URL('mobile-schedule.png',output)),fullPage:true});report.checks.push('Member isolation and responsive schedule at 390px');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1;}
finally{await browser.close();await new Promise(r=>server.close(r));await writeFile(new URL('verification.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
