import {ApplicationError} from '../../application.mjs';

const origin='https://acruxanalog-vod.secdn.net';
const prefix='/acruxanalog-vod/play/',suffix='/playlist.m3u8';
const fail=()=>{throw new ApplicationError('Media delivery temporarily unavailable',503);};
// Interpret the persisted, provider-returned mapping, never a title or a guessed path.
export function scaleEngineAssetScope(binding){
 if(binding?.provider!=='scaleengine'||binding.integrationRef!=='development-media'||binding.state!=='ready')fail();
 const raw=binding.playbackRef;
 if(typeof raw!=='string'||/[\\%\s*?#]/.test(raw))fail();
 let url;try{url=new URL(raw);}catch{fail();}
 if(url.href!==raw||url.origin!==origin||url.username||url.password||!url.pathname.startsWith(prefix)||!url.pathname.endsWith(suffix))fail();
 const video=url.pathname.slice(prefix.length,-suffix.length),parts=video.split('/');
 if(parts.length<3||!/^sestore[0-9]+$/.test(parts[0])||parts.some(p=>!p||p==='.'||p==='..'||!/^[A-Za-z0-9_.-]+$/.test(p)))fail();
 const asset=binding.assetRef;
 if(typeof asset!=='string'||!/^\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(asset)||asset.split('/').some(p=>p==='.'||p==='..')||parts.at(-1)!==asset.split('/').at(-1)||!video.endsWith('.mp4'))fail();
 return {app:'acruxanalog-vod',video,playbackRef:raw};
}
