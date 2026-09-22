// Loopback-only synthetic identity; the real read-only application projection/assets.
import {createServer} from 'node:http';
import {createDevelopmentServer} from '../src/runtime/web.mjs';
import {visibleState} from '../src/application.mjs';
import {portalFixture,portalActor} from './member-portal-fixture.mjs';
const state=portalFixture(),assets=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'});
const server=createServer((req,res)=>{
 const json=value=>{res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
 if(req.url?.startsWith('/api/auth/'))return json({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',expiresIn:3600});
 if(req.url==='/api/app')return json({...visibleState(state,portalActor),context:portalActor,mode:'development',jobs:[]});
 if(req.method!=='GET'){res.writeHead(405);res.end();return;}
 assets.emit('request',req,res);
});
server.listen(0,'127.0.0.1',()=>console.log(`Local portal harness: http://127.0.0.1:${server.address().port}`));
