import {errorMonitor} from 'node:events';

// Temporary diagnostics: fixed fields only; never serialize request/error objects.
export function attachHealthDiagnostics(server,{commit,pid=process.pid,write=line=>console.log(line)}={}){
 const revision=/^[a-f0-9]{40}$/i.test(commit||'')?commit:'unavailable';
 const sockets=new WeakMap();let connectionSequence=0,requestSequence=0;
 const emit=(event,fields={})=>write(JSON.stringify({diagnostic:'vega-web-health',event,pid,commit:revision,...fields}));
 const code=error=>['EADDRINUSE','EACCES','ECONNRESET','EPIPE','ETIMEDOUT','ERR_STREAM_PREMATURE_CLOSE'].includes(error?.code)?error.code:'other';
 server.on('listening',()=>{const a=server.address();emit('listening',{address:typeof a==='object'?a?.address:null,port:typeof a==='object'?a?.port:null,family:typeof a==='object'?a?.family:null});});
 // errorMonitor observes errors without suppressing the existing error behavior.
 server.on(errorMonitor,error=>emit('server_error',{code:code(error)}));
 server.on('close',()=>emit('server_close'));
 server.prependListener('request',(req,res)=>{
  if(req.url?.split('?')[0]!=='/health/live')return;
  const socket=req.socket;let connectionId=sockets.get(socket);
  if(!connectionId){
   connectionId=++connectionSequence;sockets.set(socket,connectionId);
   socket.on('close',hadError=>emit('health_connection_close',{connectionId,hadError}));
   socket.on(errorMonitor,error=>emit('health_connection_error',{connectionId,code:code(error)}));
  }
  const requestId=++requestSequence,fields={connectionId,requestId};
  emit('health_request',{...fields,method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'].includes(req.method)?req.method:'OTHER',path:'/health/live'});
  req.on('aborted',()=>emit('health_request_aborted',fields));
  req.on('close',()=>emit('health_request_close',{...fields,complete:req.complete}));
  req.on(errorMonitor,error=>emit('health_request_error',{...fields,code:code(error)}));
  res.on('finish',()=>emit('health_response_finish',{...fields,status:res.statusCode}));
  res.on('close',()=>emit('health_response_close',{...fields,finished:res.writableFinished,status:res.statusCode}));
  res.on(errorMonitor,error=>emit('health_response_error',{...fields,code:code(error)}));
 });
 return {signal:signal=>{if(['SIGINT','SIGTERM'].includes(signal))emit('termination_signal',{signal});}};
}
