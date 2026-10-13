// Provider-native presentation only. Never accept a caller-supplied embed URL.
export function mountExternalMedia(host,{provider,id}){
 const valid=provider==='youtube'?/^[A-Za-z0-9_-]{11}$/:provider==='vimeo'?/^[1-9][0-9]{0,19}$/:/$a/;
 if(typeof id!=='string'||!valid.test(id))throw Error('Unsupported external media');
 host.replaceChildren();
 const notice=document.createElement('p');notice.textContent='Playback is provided by '+(provider==='youtube'?'YouTube':'Vimeo')+'. Source restrictions may prevent viewing. Acrux access does not restrict direct access at the source.';
 const button=document.createElement('button');button.textContent='Load '+(provider==='youtube'?'YouTube':'Vimeo')+' player';
 host.append(notice,button);
 button.addEventListener('click',()=>{
  const frame=document.createElement('iframe');frame.title=provider==='youtube'?'YouTube video player':'Vimeo video player';
  frame.src=provider==='youtube'?`https://www.youtube.com/embed/${id}`:`https://player.vimeo.com/video/${id}`;
  frame.width='640';frame.height='360';frame.className='external-media-frame';frame.allow='fullscreen; picture-in-picture; encrypted-media';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';
  button.replaceWith(frame);
 },{once:true});
 return {destroy(){host.replaceChildren();}};
}
