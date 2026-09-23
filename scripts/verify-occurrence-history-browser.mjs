import {chromium} from 'file:///C:/Users/Joe%20Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {classEditingFixture} from './class-editing-fixture.mjs';
import {classCancellationOption} from '../src/class-cancellation.mjs';
const fixture=classEditingFixture(),{server,store,staff,member}=fixture,output=new URL('../docs/occurrence-history-local/',import.meta.url);
const command=(action,body)=>store.command(staff.userId,{action,body:{requestId:crypto.randomUUID(),...body}});
let d=await store.read(staff.userId),source=d.classes.find(c=>c.id==='c');
const {id,status,reservedCount,...sourceDetails}=source;
let body={classId:'c',versionToken:d.classEditOptions.find(o=>o.classId==='c').versionToken,details:{...sourceDetails,title:'Recorded edited title'},reason:'Local history verification <script>not executable</script>'};
let review=await store.reviewClassEdit(staff.userId,body);await command('edit-class',{...body,reviewToken:review.reviewToken});
d=await store.read(staff.userId);body={classId:'c',versionToken:d.classDuplicateOptions.find(o=>o.classId==='c').versionToken,details:{startsAt:'2099-10-03T12:00:00Z'}};
review=await store.reviewClassDuplicate(staff.userId,body);const copy=await command('duplicate-class',{...body,reviewToken:review.reviewToken});
let s=fixture.snapshot();await command('cancel-class',{classId:'c',reason:'Local cancellation evidence',impactToken:classCancellationOption(s,s.classes.find(c=>c.id==='c'),new Date().toISOString()).impactToken});
const past=await command('class',{...source,title:'Past occurrence',startsAt:'2000-01-01T12:00:00Z'});
const before=fixture.snapshot(),beforeRead=await store.read(staff.userId);
await mkdir(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`,report={scope:'Loopback synthetic auth, real API/domain/projection; no hosted or provider access',checks:[],errors:[],mutationRequests:[]};let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const context=await browser.newContext({viewport:{width:1440,height:1050},timezoneId:'America/Los_Angeles'}),page=await context.newPage();page.setDefaultTimeout(10000);
 function observe(p){p.on('pageerror',e=>report.errors.push(e.message));p.on('request',r=>{if(r.url().includes('/api/')&&!r.url().includes('/api/auth/')&&r.method()!=='GET')report.mutationRequests.push(r.url());});}
 async function login(p,role){observe(p);await p.goto(base);await p.locator('#login [name=email]').fill(`${role}@local.test`);await p.locator('#login [name=password]').fill('synthetic');await p.locator('#login button').click();await p.locator('#sign-out').waitFor();}
 await login(page,'staff');await page.goto(base+'/#schedule');await page.locator('#roster-class').selectOption('c');
 const history=page.locator('.occurrence-history');await history.waitFor();assert.equal(await history.locator('[data-history-event]').count(),3);assert.equal(await history.locator('[data-history-event="cancellation"]').count(),1);assert.equal(await history.locator('button,input,form').count(),0);
 await history.locator('[data-history-event="edit"] summary').filter({hasText:/^(Before|After)$/}).evaluateAll(nodes=>nodes.forEach(n=>n.click()));
 assert.ok((await history.innerText()).includes('Schedule Editing Test'));assert.ok((await history.innerText()).includes('Recorded edited title'));assert.ok((await history.innerText()).includes('<script>not executable</script>'));assert.equal(await history.locator('script').count(),0);
 await history.scrollIntoViewIfNeeded();await page.screenshot({path:fileURLToPath(new URL('desktop-history.png',output)),fullPage:true});
 const initial=await history.innerText();await page.reload();await page.locator('#roster-class').selectOption('c');assert.equal(await history.locator('[data-history-event]').count(),3);assert.ok(initial.includes(staff.userId));
 report.checks.push('Cancelled source shows one creation, edit and cancellation with attributable evidence and recorded snapshots; escaped text; reload persists');
 await page.locator('#roster-class').selectOption(copy.id);assert.equal(await history.locator('[data-history-event]').count(),1);assert.equal(await history.locator('[data-history-event="creation-from-existing"]').count(),1);
 await history.getByText('Created occurrence snapshot',{exact:true}).click();assert.ok((await history.innerText()).includes('Recorded edited title'));assert.ok((await history.innerText()).includes('Source occurrence: c'));assert.equal(await history.locator('[data-history-event="edit"]').count(),0);
 await page.setViewportSize({width:390,height:844});await history.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:fileURLToPath(new URL('mobile-copy-history.png',output)),fullPage:true});
 await page.locator('#roster-class').selectOption('c');await history.locator('summary').evaluateAll(nodes=>nodes.forEach(n=>n.click()));await history.scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:fileURLToPath(new URL('mobile-source-history.png',output)),fullPage:true});
 report.checks.push('Copy provenance appears once, independent of source edit/cancellation; desktop/mobile details expand without overflow');
 await page.locator('#roster-class').selectOption(past.id);assert.equal(await history.locator('[data-history-event="creation"]').count(),1);await history.getByText('After',{exact:true}).click();assert.ok((await history.innerText()).includes('unrecorded'));report.checks.push('Past occurrences remain selectable; creation snapshot gaps shown as unrecorded');
 const memberPage=await browser.newPage({viewport:{width:390,height:844}});await login(memberPage,'member');await memberPage.goto(base+'/#classes');await memberPage.reload();assert.equal(await memberPage.locator('.occurrence-history').count(),0);await memberPage.goto(base+'/#schedule');assert.equal(await memberPage.locator('.occurrence-history').count(),0);
 const staffRead=await store.read(staff.userId),memberRead=await store.read(member.userId);
 for(const c of staffRead.classes){const {editHistory,cancellationHistory,creationProvenance,...visible}=c;assert.deepEqual(memberRead.classes.find(m=>m.id===c.id),visible);}
 assert.deepEqual(memberRead.activity,[]);assert.deepEqual(fixture.snapshot(),before);assert.equal(staffRead.revision,beforeRead.revision);assert.deepEqual(report.mutationRequests,[]);assert.deepEqual(report.errors,[]);
 report.checks.push('Member has no occurrence audit UI/data; refreshed staff/member schedules agree; browsing causes zero mutations and no revision/state changes');report.passed=true;
}catch(e){report.passed=false;report.failure=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));await writeFile(new URL('verification.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
