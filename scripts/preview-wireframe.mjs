import {createDevelopmentServer} from '../src/runtime/web.mjs';
const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
server.listen(10002,'127.0.0.1',()=>console.log('Vega synthetic wireframe: http://127.0.0.1:10002'));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close());
