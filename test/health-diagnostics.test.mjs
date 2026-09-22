import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once,EventEmitter,errorMonitor} from 'node:events';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {attachHealthDiagnostics} from '../src/runtime/health-diagnostics.mjs';

test('diagnostics preserve health responses and omit sensitive and unrelated traffic',async()=>{
 const lines=[],server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
 const d=attachHealthDiagnostics(server,{commit:'a'.repeat(40),write:l=>lines.push(JSON.parse(l))});
 server.listen(0,'0.0.0.0');await once(server,'listening');
 try{
  const origin=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin+'/health/live',{headers:{cookie:'secret-cookie',authorization:'secret-token'}})).status,200);
  assert.equal((await fetch(origin+'/health/live',{method:'HEAD'})).status,503);
  await fetch(origin+'/unrelated-secret');
  d.signal('SIGTERM');d.signal('secret-signal');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
 assert.equal(lines[0].address,'0.0.0.0');assert.ok(lines[0].port>0);assert.equal(lines[0].family,'IPv4');
 assert.deepEqual(lines.filter(x=>x.event==='health_response_finish').map(x=>x.status),[200,503]);
 assert.equal(lines.filter(x=>x.event==='health_request').length,2);
 assert.ok(lines.some(x=>x.event==='termination_signal'));assert.ok(lines.some(x=>x.event==='server_close'));
 assert.doesNotMatch(JSON.stringify(lines),/secret|authorization|cookie|unrelated/);
});
test('error observation does not install an error handler or log error messages',()=>{
 const server=new EventEmitter(),lines=[];attachHealthDiagnostics(server,{commit:'sensitive-invalid-value',write:l=>lines.push(l)});
 assert.equal(server.listenerCount('error'),0);assert.equal(server.listenerCount(errorMonitor),1);
 assert.throws(()=>server.emit('error',Object.assign(new Error('sensitive error'),{code:'EADDRINUSE'})),/sensitive error/);
 assert.match(lines[0],/EADDRINUSE/);assert.doesNotMatch(lines[0],/sensitive/);
});
