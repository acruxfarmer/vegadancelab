import {ApplicationError} from '../application.mjs';
export async function handleExternalMediaApi(req,{service,principal,readJson,send}){
 const url=new URL(req.url,'http://local');
 const match=url.pathname.match(/^\/api\/external-media\/(vimeo|youtube)\/(discover|register)$/);
 const resource=url.pathname.match(/^\/api\/external-media\/resources\/([0-9a-f-]{36})\/(refresh|preview)$/i);
 if(!match&&!resource)return false;
 if(!service)throw new ApplicationError('External library unavailable',503);
 if(req.method!=='POST'||url.search)throw new ApplicationError('Invalid external media request',400);
 const identity=await principal(req);
 if(!identity||typeof identity!=='object')throw new ApplicationError('Choose an authorized business',403);
 const input=await readJson(req);
 const action=match?.[2]||resource[2],allowed={discover:['page'],register:['id'],refresh:['expectedRevision'],preview:[]}[action];
 if(Object.keys(input).some(k=>!allowed.includes(k)))throw new ApplicationError('Unsupported external media fields',400);
 const result=match?await service[action](identity,match[1],action==='discover'?(input.page??''):input.id):await service[action](identity,resource[1],input.expectedRevision);
 send(200,result);return true;
}
