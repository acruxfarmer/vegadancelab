// Generic HLS delivery only. The server owns access and provider authorization.
export function scopedPlaybackUrl(raw,grant){
 const base=new URL(grant.url),u=new URL(raw,base);
 const directory=base.pathname.slice(0,base.pathname.lastIndexOf('/')+1);
 if(base.protocol!=='https:'||u.origin!==base.origin||!u.pathname.startsWith(directory)||u.username||u.password||u.hash)throw Error('Playback reference unavailable');
 if(grant.inheritQuery)for(const [key,value] of base.searchParams)u.searchParams.set(key,value);
 return u.href;
}
export async function playNative(video,grant,onError){
 if(grant.kind!=='hls'||!Number.isFinite(Date.parse(grant.expiresAt))||Date.parse(grant.expiresAt)<=Date.now())throw Error('Playback authorization expired');
 const source=scopedPlaybackUrl(grant.url,grant);
 if(!window.Hls)await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/vendor/hls-1.7.3.light.min.js';script.onload=resolve;script.onerror=reject;document.head.append(script);});
 if(window.Hls.isSupported()){
  const hls=new window.Hls({enableWorker:false,debug:false,xhrSetup(xhr,url){xhr.open('GET',scopedPlaybackUrl(url,grant),true);}});
  hls.on(window.Hls.Events.ERROR,(_event,data)=>{if(data.fatal){hls.destroy();onError();}});
  hls.loadSource(source);hls.attachMedia(video);
  try{await video.play();}catch{hls.destroy();throw Error('Playback unavailable');}
  return ()=>hls.destroy();
 }
 if(video.canPlayType('application/vnd.apple.mpegurl')){video.src=source;await video.play();return ()=>{video.removeAttribute('src');video.load();};}
 throw Error('HLS playback unavailable in this browser');
}
