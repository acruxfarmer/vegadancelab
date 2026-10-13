import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../public/media-connections.js',import.meta.url),'utf8').replace("import {createSession} from './session.js';",'');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function screen(fetcher,access=async()=>'test-token'){
 const root={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[],addEventListener:()=>{}},notice={textContent:''};
 let callbacks;
 const context=vm.createContext({document:{querySelector:selector=>selector==='#connections'?root:notice},createSession:options=>{callbacks=options;return {restore:()=>false,access};},sessionStorage:{},fetch:fetcher,AbortSignal,URL,location:{hash:''},history:{}});
 vm.runInContext(source,context);
 return {run:code=>vm.runInContext(code,context),root,lost:()=>callbacks.onLost()};
}
test('connection request retains selected business across an authentication wait',async()=>{
 const token=deferred();let headers;
 const s=screen(async(_url,options)=>{headers=options.headers;return {ok:true,json:async()=>({})};},()=>token.promise);
 s.run("business={tenantId:'tenant',businessId:'first'}");
 const result=s.run("request('/api/media-connections/vimeo')");
 s.run("business={tenantId:'tenant',businessId:'second'}");token.resolve('test-token');await result;
 assert.equal(headers['x-vega-business'],'first');
});
test('late status response cannot replace the newly selected business view',async()=>{
 const old=deferred();
 const s=screen(async(_url,options)=>options.headers['x-vega-business']==='first'?old.promise:{ok:true,json:async()=>({status:'connected',accountName:'Second account'})});
 s.run("businesses=[{tenantId:'tenant',businessId:'first',name:'First'},{tenantId:'tenant',businessId:'second',name:'Second'}];business=businesses[0]");
 const first=s.run('load()');await Promise.resolve();
 s.run('business=businesses[1]');await s.run('load()');
 old.resolve({ok:true,json:async()=>({status:'connected',accountName:'First account'})});await first;
 assert.match(s.root.innerHTML,/Second account/);assert.doesNotMatch(s.root.innerHTML,/First account/);
});
test('session loss removes connection details and invalidates in-flight display results',async()=>{
 const pending=deferred();const s=screen(()=>pending.promise);
 s.run("businesses=[{tenantId:'tenant',businessId:'first',name:'First'}];business=businesses[0]");
 const result=s.run('load()');await Promise.resolve();s.lost();
 pending.resolve({ok:true,json:async()=>({status:'connected',accountName:'Private account'})});await result;
 assert.match(s.root.innerHTML,/Sign in/);assert.doesNotMatch(s.root.innerHTML,/Private account/);
});
