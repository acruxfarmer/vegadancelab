import {playNative} from './native-player.js';

// Source selection only. Callers obtain authorization before supplying a source.
// Future embed adapters can implement this attachment/cleanup boundary.
export async function attachPlayerSource(video,source,onError){
 if(source?.kind==='hls')return playNative(video,source,onError);
 if(source?.kind!=='mp4'||!(source.blob instanceof Blob)||!source.blob.size)throw Error('Media unavailable');
 const url=URL.createObjectURL(source.blob);
 video.src=url;
 try{await video.play();}catch{URL.revokeObjectURL(url);throw Error('Playback could not start');}
 return ()=>{video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);};
}
