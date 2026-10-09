// Local browser fixture: existing synthetic Layer 5 MP4, no external services.
import {readFile} from 'node:fs/promises';
import {createDevelopmentServer} from '../src/runtime/refund-web.mjs';
import {resolveMediaViewerAccess} from '../src/media-viewer-access.mjs';
import {ApplicationError} from '../src/application.mjs';
const id='66666666-6666-4666-8666-666666666666';
const bytes=await readFile(new URL('../records/media-proof.local.mp4',import.meta.url));
const decision=p=>resolveMediaViewerAccess({placement:{resourceId:'fixture',authorized:p===id,visible:true,context:{kind:'business',tenantId:'local',businessId:'local'},policy:{kind:'public'}},resourceId:'fixture',resourceAvailable:true,viewerId:null});
const server=createDevelopmentServer({VEGA_ENV:'development',VEGA_EXTERNAL_EFFECTS:'disabled'},null,null,{
 mediaPlacementView:async(_,p)=>({decision:decision(p),metadata:{title:'Acrux player · existing MP4 proof',description:'Local synthetic Layer 5 test pattern',poster:'/media-poster.svg'}}),
 mediaPlacementPlayback:async(_,p)=>{if(!decision(p).allowed)throw new ApplicationError('Media unavailable',403);return bytes;}
});
server.listen(10016,'127.0.0.1',()=>console.log('Local player fixture: http://127.0.0.1:10016/watch.html?placement='+id));
