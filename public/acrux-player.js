import {attachPlayerSource} from './player-source.js';

const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function playerTime(seconds){
 if(!Number.isFinite(seconds)||seconds<0)return '0:00';
 const n=Math.floor(seconds),h=Math.floor(n/3600),m=Math.floor(n%3600/60),s=String(n%60).padStart(2,'0');
 return h?`${h}:${String(m).padStart(2,'0')}:${s}`:`${m}:${s}`;
}
export function playerMarkup({title='Video',poster='/media-poster.svg'}={}){
 return `<section class="acrux-player" aria-label="${escape(title)} player" data-state="idle">
 <div class="acrux-player-stage"><video playsinline preload="none" poster="${escape(poster)}" aria-label="${escape(title)}"></video><div class="acrux-player-captions" aria-live="off"></div></div>
 <div class="acrux-player-controls">
 <label class="acrux-player-timeline">Timeline<input data-control="timeline" type="range" min="0" max="100" step="0.1" value="0" disabled aria-label="Seek video"></label>
 <div class="acrux-player-buttons"><button type="button" data-control="play" title="Play video">Play</button><output data-control="time" aria-label="Playback time">0:00 / 0:00</output>
 <button type="button" data-control="mute" aria-pressed="false" title="Mute audio">Mute</button><label class="acrux-player-volume">Volume<input data-control="volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume"></label>
 <button type="button" data-control="mirror" aria-pressed="false" title="Flip the video image horizontally">Mirror</button><button type="button" data-control="fullscreen" title="Enter fullscreen">Fullscreen</button></div>
 <p class="acrux-player-status" role="status" aria-live="polite">Choose Play to begin.</p>
 </div></section>`;
}

// One shell for already-authorized sources. No memberships, ownership or payment
// rules belong here. getSource is supplied by the existing access-aware caller.
export function mountAcruxPlayer(container,{getSource,title,poster,attachSource=attachPlayerSource}){
 container.innerHTML=playerMarkup({title,poster});
 const root=container.querySelector('.acrux-player'),video=root.querySelector('video');
 const control=name=>root.querySelector(`[data-control="${name}"]`);
 const play=control('play'),timeline=control('timeline'),time=control('time'),mute=control('mute'),volume=control('volume'),mirror=control('mirror'),fullscreen=control('fullscreen');
 const status=root.querySelector('[role="status"]'),captions=root.querySelector('.acrux-player-captions');
 let disposed=false,busy=false,source=null,release=null,mirrored=false,failed=false;
 const listeners=[],tracks=new Set();
 const on=(target,event,handler)=>{target?.addEventListener(event,handler);listeners.push(()=>target?.removeEventListener(event,handler));};
 function state(name,message){if(disposed)return;root.dataset.state=name;status.textContent=message;play.title=play.textContent+' video';}
 function progress(){
  const duration=Number.isFinite(video.duration)?video.duration:0;
  timeline.disabled=!duration||failed;timeline.max=String(duration||100);timeline.value=String(video.currentTime||0);
  timeline.setAttribute('aria-valuetext',`${playerTime(video.currentTime)} of ${playerTime(duration)}`);
  time.textContent=`${playerTime(video.currentTime)} / ${playerTime(duration)}`;
 }
 function audio(){mute.textContent=video.muted||video.volume===0?'Unmute':'Mute';mute.title=mute.textContent+' audio';mute.setAttribute('aria-pressed',String(video.muted||video.volume===0));volume.value=String(video.volume);}
 function error(message='Playback could not start. Try again.'){
  if(disposed)return;failed=true;video.pause();release?.();release=null;source=null;
  play.disabled=false;play.textContent='Try again';timeline.disabled=true;state('error',message);
 }
 async function togglePlay(){
  if(disposed||busy)return;
  if(source&&!failed&&!video.paused&&!video.ended){video.pause();return;}
  busy=true;play.disabled=true;failed=false;
  try{
   if(!source||(source.expiresAt&&Date.parse(source.expiresAt)<=Date.now())){
    release?.();release=null;source=null;state('loading','Loading video…');
    const next=await getSource();if(disposed)return;
    source=next;
    const stop=await attachSource(video,next,()=>error('Connection interrupted. Try again.'));
    if(disposed){stop?.();return;}release=stop;
   }else{if(video.ended)video.currentTime=0;await video.play();}
  }catch{error();}finally{busy=false;if(!disposed)play.disabled=false;}
 }
 on(play,'click',togglePlay);
 on(video,'loadedmetadata',()=>{progress();if(!failed)state('ready','Ready to play.');});
 on(video,'canplay',()=>{if(video.paused&&!failed)state('ready','Ready to play.');});
 on(video,'playing',()=>{if(failed)return;play.textContent='Pause';state('playing','Playing');});
 on(video,'pause',()=>{if(!failed&&!video.ended){play.textContent='Play';state('paused','Paused');}});
 on(video,'waiting',()=>{if(!failed)state('buffering','Buffering…');});
 on(video,'ended',()=>{play.textContent='Replay';progress();state('ended','Video ended. Choose Replay to watch again.');});
 on(video,'timeupdate',progress);on(video,'durationchange',progress);
 on(video,'error',()=>error('This media is unavailable. Try again.'));
 on(timeline,'input',()=>{const position=Number(timeline.value);if(Number.isFinite(video.duration)&&Number.isFinite(position)){video.currentTime=Math.max(0,Math.min(video.duration,position));progress();}});
 on(volume,'input',()=>{video.volume=Math.max(0,Math.min(1,Number(volume.value)||0));if(video.volume>0)video.muted=false;audio();});
 on(mute,'click',()=>{video.muted=!(video.muted||video.volume===0);if(!video.muted&&video.volume===0)video.volume=1;audio();});
 on(video,'volumechange',audio);
 on(mirror,'click',()=>{mirrored=!mirrored;video.classList.toggle('acrux-video-mirrored',mirrored);mirror.setAttribute('aria-pressed',String(mirrored));mirror.title=mirrored?'Restore original orientation':'Flip the video image horizontally';});
 const doc=root.ownerDocument;
 fullscreen.disabled=typeof root.requestFullscreen!=='function';
 if(fullscreen.disabled)fullscreen.title='Fullscreen is unavailable in this browser';
 on(fullscreen,'click',async()=>{try{if(doc.fullscreenElement===root)await doc.exitFullscreen();else await root.requestFullscreen();}catch{status.textContent='Fullscreen is unavailable in this browser.';}});
 on(doc,'fullscreenchange',()=>{fullscreen.textContent=doc.fullscreenElement===root?'Exit fullscreen':'Fullscreen';fullscreen.title=doc.fullscreenElement===root?'Exit fullscreen':'Enter fullscreen';});
 // Native cue rendering lives inside <video> and would be mirrored. Render
 // selected text tracks in an ordinary sibling overlay, using plain text only.
 function cueText(){captions.textContent=[...tracks].filter(t=>t.mode!=='disabled').flatMap(t=>[...(t.activeCues||[])].map(c=>c.text)).join('\n');}
 function syncTracks(){for(const track of video.textTracks||[]){if(track.mode==='showing')track.mode='hidden';if(!tracks.has(track)){tracks.add(track);on(track,'cuechange',cueText);}}cueText();}
 on(video.textTracks,'addtrack',syncTracks);on(video.textTracks,'change',syncTracks);syncTracks();
 return {destroy(){if(disposed)return;disposed=true;for(const off of listeners)off();video.pause();release?.();release=null;video.removeAttribute('src');video.load();container.replaceChildren();}};
}
