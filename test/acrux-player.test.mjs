import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mountAcruxPlayer,playerMarkup,playerTime} from '../public/acrux-player.js';
import {attachPlayerSource} from '../public/player-source.js';
import {mediaUI} from '../public/media-ui.js';

class Element extends EventTarget{
 constructor(){super();this.dataset={};this.attributes={};this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};this.value='0';this.textContent='';this.disabled=false;}
 setAttribute(k,v){this.attributes[k]=v;}removeAttribute(k){delete this.attributes[k];}
 emit(name){this.dispatchEvent(new Event(name));}
}
function fixture(getSource=async()=>({kind:'mp4',blob:new Blob(['fixture'])}),options={}){
 const video=new Element();Object.assign(video,{paused:true,ended:false,currentTime:0,duration:60,volume:1,muted:false,textTracks:Object.assign(new EventTarget(),{[Symbol.iterator]:function*(){}})});
 video.play=async()=>{video.paused=false;video.ended=false;video.emit('playing');};video.pause=()=>{video.paused=true;video.emit('pause');};video.load=()=>{};
 const root=new Element(),doc=new Element(),controls=Object.fromEntries(['play','timeline','time','mute','volume','mirror','fullscreen'].map(x=>[x,new Element()])),status=new Element(),captions=new Element();
 root.ownerDocument=doc;root.requestFullscreen=async()=>{doc.fullscreenElement=root;doc.emit('fullscreenchange');};doc.exitFullscreen=async()=>{doc.fullscreenElement=null;doc.emit('fullscreenchange');};
 root.querySelector=s=>s==='video'?video:s==='[role="status"]'?status:s==='.acrux-player-captions'?captions:controls[s.match(/data-control="(.+)"/)?.[1]];
 const host={querySelector:()=>root,replaceChildren(){this.removed=true;}};let attachments=0,cleanups=0;
 const player=mountAcruxPlayer(host,{getSource,...options,attachSource:async(v)=>{attachments++;await v.play();return ()=>cleanups++;}});
 return {video,root,doc,controls,status,captions,host,player,attachments:()=>attachments,cleanups:()=>cleanups};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('one shell has labelled controls outside the mirrored video, and escapes metadata',()=>{
 const html=playerMarkup({title:'<script>bad</script>'});assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<video controls'));
 assert.ok(html.indexOf('</video>')<html.indexOf('acrux-player-captions'));assert.ok(html.indexOf('</video>')<html.indexOf('data-control="mirror"'));
 for(const label of ['Seek video','Volume','Mirror','Fullscreen','role="status"'])assert.ok(html.includes(label));
 assert.equal(playerTime(3661),'1:01:01');assert.equal(playerTime(NaN),'0:00');
});
test('play, pause, seek and ended replay share one source attachment',async()=>{
 const f=fixture();assert.equal(f.attachments(),0);f.controls.play.emit('click');await settle();assert.equal(f.root.dataset.state,'playing');assert.equal(f.attachments(),1);
 f.controls.play.emit('click');assert.equal(f.video.paused,true);assert.equal(f.root.dataset.state,'paused');
 f.controls.timeline.value='24';f.controls.timeline.emit('input');assert.equal(f.video.currentTime,24);
 f.video.ended=true;f.video.emit('ended');assert.equal(f.root.dataset.state,'ended');assert.equal(f.controls.play.textContent,'Replay');
 f.controls.play.emit('click');await settle();assert.equal(f.video.currentTime,0);assert.equal(f.attachments(),1);f.player.destroy();assert.equal(f.cleanups(),1);
});
test('mirror survives buffering, pause and fullscreen without changing source or time',async()=>{
 const f=fixture();f.controls.play.emit('click');await settle();f.video.currentTime=12;
 assert.equal(f.video.classes.has('acrux-video-mirrored'),false);f.controls.mirror.emit('click');
 f.video.emit('waiting');assert.equal(f.root.dataset.state,'buffering');f.controls.fullscreen.emit('click');await settle();
 assert.equal(f.doc.fullscreenElement,f.root);assert.equal(f.video.classes.has('acrux-video-mirrored'),true);assert.equal(f.controls.mirror.attributes['aria-pressed'],'true');assert.equal(f.root.classes.size,0);assert.equal(f.video.currentTime,12);assert.equal(f.attachments(),1);
 f.controls.mirror.emit('click');assert.equal(f.video.classes.has('acrux-video-mirrored'),false);f.player.destroy();
});
test('volume and mute use media capabilities and retain visible state',()=>{
 const f=fixture();f.controls.volume.value='0.35';f.controls.volume.emit('input');assert.equal(f.video.volume,.35);
 f.controls.mute.emit('click');assert.equal(f.video.muted,true);assert.equal(f.controls.mute.textContent,'Unmute');f.controls.mute.emit('click');assert.equal(f.video.muted,false);f.player.destroy();
});
test('loading, ready and generic errors do not expose upstream diagnostic details',async()=>{
 let reject;const f=fixture(()=>new Promise((_,r)=>reject=r));f.controls.play.emit('click');assert.equal(f.root.dataset.state,'loading');
 f.video.emit('loadedmetadata');assert.equal(f.root.dataset.state,'ready');reject(Error('private token provider failure'));await settle();assert.equal(f.root.dataset.state,'error');assert.ok(!f.status.textContent.includes('token'));assert.equal(f.attachments(),0);f.player.destroy();
});
test('unmount while awaiting authorization never instantiates a playable source',async()=>{
 let resolve;const f=fixture(()=>new Promise(r=>resolve=r));f.controls.play.emit('click');f.player.destroy();resolve({kind:'hls'});await settle();assert.equal(f.attachments(),0);assert.equal(f.host.removed,true);
});
test('MP4 adapter owns and releases its local object URL; unsupported sources fail closed',async()=>{
 const v={play:async()=>{},pause(){},removeAttribute(){},load(){}};
 const cleanup=await attachPlayerSource(v,{kind:'mp4',blob:new Blob(['movie'],{type:'video/mp4'})});assert.ok(v.src.startsWith('blob:'));cleanup();
 await assert.rejects(attachPlayerSource(v,{kind:'youtube',url:'https://example.test'}));
});
test('locked library items have no player mount point and perform no playback calls',async()=>{
 let calls=0;const v={id:'v',title:'Locked',poster:'/media-poster.svg',accessDecision:{allowed:false,reason:'membership_required'}};
 const ui=mediaUI({getData:()=>({context:{role:'member'},videos:[v]}),api:()=>calls++,escape:s=>String(s??''),render(){}});
 await ui.click({dataset:{mediaOpen:'v'},hasAttribute:()=>false});assert.ok(!ui.html().includes('data-acrux-player'));assert.equal(calls,0);
});
test('mirror CSS targets only the video, never controls or the player container',async()=>{
 const css=await readFile(new URL('../public/acrux-player.css',import.meta.url),'utf8');
 assert.match(css,/\.acrux-player video\.acrux-video-mirrored\{transform:scaleX\(-1\)\}/);assert.equal((css.match(/transform:/g)||[]).length,1);
});
test('selected captions render as plain text outside the mirrored surface',()=>{
 const f=fixture(),track=new Element();track.mode='showing';track.activeCues=[{text:'Left <safe text>'}];
 f.video.textTracks[Symbol.iterator]=function*(){yield track;};f.video.textTracks.dispatchEvent(new Event('addtrack'));
 f.controls.mirror.emit('click');assert.equal(track.mode,'hidden');assert.equal(f.captions.textContent,'Left <safe text>');assert.equal(f.captions.classes.size,0);f.player.destroy();
});
test('authorized HLS uses the existing isolated attachment path and cleanup',async()=>{
 const prior=globalThis.window;let instance;
 class Hls{static isSupported(){return true;}static Events={ERROR:'error'};constructor(options){instance=this;this.options=options;}on(_,cb){this.error=cb;}loadSource(url){this.url=url;}attachMedia(video){this.video=video;}destroy(){this.destroyed=true;}}
 globalThis.window={Hls};
 try{const video={play:async()=>{video.played=true;}};const grant={kind:'hls',url:'https://media.example.test/asset/playlist.m3u8?key=fixture&pass=fixture',inheritQuery:true,expiresAt:new Date(Date.now()+60000).toISOString()};const stop=await attachPlayerSource(video,grant,()=>{});assert.equal(instance.url,grant.url);assert.equal(video.played,true);let child;instance.options.xhrSetup({open:(_,url)=>child=url},'https://media.example.test/asset/part.ts');assert.ok(child.endsWith('?key=fixture&pass=fixture'));stop();assert.equal(instance.destroyed,true);}finally{globalThis.window=prior;}
});

for(const stages of [['PRIMARY'],['PRE_ROLL','PRIMARY'],['PRIMARY','POST_ROLL'],['PRE_ROLL','PRIMARY','POST_ROLL']])test('sequence automatically executes once in order: '+stages.join(' -> '),async()=>{
 const calls=[];let manifests=0;
 const f=fixture(async s=>{calls.push(s.stage);return {kind:'mp4'};},{getSequence:async()=>{manifests++;return {revision:2,stages};}});
 f.controls.play.emit('click');await settle();f.controls.mirror.emit('click');
 for(let i=0;i<stages.length;i++){
  assert.equal(f.root.dataset.stage,stages[i]);f.video.ended=true;f.video.emit('ended');f.video.emit('ended');await settle();
 }
 assert.deepEqual(calls,stages);assert.equal(f.root.dataset.state,'ended');assert.equal(f.video.classes.has('acrux-video-mirrored'),true);
 f.controls.play.emit('click');await settle();assert.equal(manifests,2);assert.equal(calls.at(-1),stages[0]);f.player.destroy();assert.equal(f.cleanups(),f.attachments());
});
test('denied sequence starts no stage',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;},{getSequence:async()=>{throw Error('denied');}});f.controls.play.emit('click');await settle();assert.equal(calls,0);assert.equal(f.attachments(),0);assert.equal(f.root.dataset.state,'error');f.player.destroy();
});
test('transition failure stops sequence and never skips to post-roll',async()=>{
 const calls=[];const f=fixture(async s=>{calls.push(s.stage);if(s.stage==='PRIMARY')throw Error('revoked');return {kind:'mp4'};},{getSequence:async()=>({revision:1,stages:['PRE_ROLL','PRIMARY','POST_ROLL']})});f.controls.play.emit('click');await settle();f.video.ended=true;f.video.emit('ended');await settle();assert.deepEqual(calls,['PRE_ROLL','PRIMARY']);assert.equal(f.root.dataset.state,'error');f.player.destroy();
});
