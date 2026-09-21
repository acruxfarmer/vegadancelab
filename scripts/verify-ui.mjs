import { chromium } from 'file:///C:/Users/Joe%20Graham/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { createDevelopmentServer } from '../src/runtime/web.mjs';
import { mkdir,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const output=new URL('../docs/screenshots/',import.meta.url);await mkdir(output,{recursive:true});
const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browsers=['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Google/Chrome/Application/chrome.exe'];
let browser;const report={checks:[],errors:[],screenshots:[],scope:'Synthetic interactive wireframe; no provider/authenticated backend effects'};
try{
 const executablePath=browsers.find(existsSync);browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1050}});page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('Failed to load resource'))report.errors.push(message.text())});
 await page.goto(base);await page.getByRole('button',{name:'Open interactive wireframe'}).click();await page.getByRole('heading',{name:'Welcome, Alex.'}).waitFor();
 await page.screenshot({path:fileURLToPath(new URL('desktop-today.png',output)),fullPage:true});report.screenshots.push('desktop-today.png');report.checks.push('Desktop member home renders');
 await page.getByRole('link',{name:'Classes',exact:true}).click();await page.getByRole('searchbox',{name:'Search classes'}).fill('ballet');assert.equal(await page.locator('article.card').count(),1);await page.getByRole('searchbox',{name:'Search classes'}).fill('');
 await page.getByRole('button',{name:'View & reserve'}).first().click();await page.getByRole('button',{name:'Reserve in wireframe'}).click();await page.getByRole('heading',{name:'My bookings'}).waitFor();assert.equal(await page.getByRole('button',{name:'Cancel reservation',exact:true}).count(),1);report.checks.push('Search and member reservation');
 await page.locator('#view').selectOption('staff');await page.getByRole('button',{name:'View roster'}).first().click();await page.getByRole('button',{name:'Check in',exact:true}).click();await page.getByRole('button',{name:'Undo check-in'}).waitFor();await page.getByRole('button',{name:'Undo check-in'}).click();report.checks.push('Staff check-in and undo');
 await page.getByRole('button',{name:'Create class'}).click();for(const [name,value]of Object.entries({title:'Browser verified class',instructor:'Test Instructor',location:'Test Studio',category:'Movement',capacity:'12',duration:'60',startsAt:'2027-01-20T17:00'}))await page.locator(`#create-class [name="${name}"]`).fill(value);await page.locator('#create-class button').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(await page.locator('#roster-class option').filter({hasText:'Browser verified class'}).count(),1);report.checks.push('Staff creates synthetic class');
 await page.getByRole('link',{name:'People',exact:true}).click();await page.getByRole('button',{name:'Add participant'}).click();await page.locator('#create-person input').fill('Test Participant');await page.locator('#create-person button').click();await page.getByRole('heading',{name:'Test Participant',exact:true}).waitFor();report.checks.push('Staff adds synthetic participant');
 for(const name of ['Communications','Processing','Reports']){await page.getByRole('link',{name,exact:true}).click();assert.ok((await page.locator('main').innerText()).length>60)}report.checks.push('All staff surfaces render');
 await page.locator('#view').selectOption('member');await page.getByRole('link',{name:'My bookings'}).click();await page.getByRole('button',{name:'Cancel reservation',exact:true}).click();await page.locator('[data-confirm-cancel]').click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.ok((await page.locator('main').innerText()).includes('cancelled'));report.checks.push('Member cancellation');
 for(const name of ['Passes & membership','Video library','Events','Studio shop','My profile']){await page.getByRole('link',{name,exact:true}).click();assert.ok((await page.locator('main').innerText()).length>60)}report.checks.push('All member surfaces render');
 await page.setViewportSize({width:390,height:844});await page.getByRole('link',{name:'Classes',exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth),false);await page.locator('#toast').waitFor({state:'hidden'});await page.screenshot({path:fileURLToPath(new URL('mobile-classes.png',output)),fullPage:true});report.screenshots.push('mobile-classes.png');report.checks.push('390px mobile class layout no horizontal page overflow');
 await page.getByRole('button',{name:'Leave workspace'}).click();await page.getByRole('heading',{name:'Studio sign in'}).waitFor();report.checks.push('Leave workspace clears access');
 assert.deepEqual(report.errors,[]);report.passed=true;
}catch(error){report.passed=false;report.failure=error.stack;process.exitCode=1}finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));await writeFile(new URL('verification.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
