export function mediaUI({getData,api,mutate,escape,render}){
 let selected=null,editing=null,objectUrl=null,generation=0;
 const release=()=>{generation++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;};
 const canManage=()=>getData()?.context?.role==='staff'&&getData()?.staffAccess?.permissions?.includes('customers.manage');
 const field=(name,label,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${escape(value)}" ${extra}></label>`;
 function html(){
  release();const d=getData(),rows=d.videos||[],v=rows.find(v=>v.id===selected),manager=canManage();
  if(editing!==null&&manager){const e=rows.find(v=>v.id===editing);return `<h1>${e?'Edit video':'Add video'}</h1><p>Development proof: one small approved MP4, up to 256 KB. Editing returns the video to draft for review.</p><form id="media-edit" class="card">${field('title','Title',e?.title,'required maxlength="160"')}<label class="field">Description<textarea name="description" maxlength="2000">${escape(e?.description||'')}</textarea></label>${field('creator','Instructor / creator',e?.creator,'maxlength="160"')}${field('duration','Duration in seconds (optional)',e?.duration??'','type="number" min="0.1" max="3600" step="0.1"')}<label class="field">Approved video asset<input name="asset" type="file" accept="video/mp4" ${e?'':'required'}></label><p>Only attach content approved for this business. A practice poster is provided.</p><button class="button">Save draft</button><button type="button" class="button secondary" data-media-back>Back to library</button><p role="alert" id="media-error"></p></form>`;}
  if(v)return `<button class="button secondary" data-media-back>Back to library</button><section class="card"><h1>${escape(v.title)}</h1><p>${escape(v.description)}</p><p>${escape(v.creator)}${v.duration?' · '+escape(v.duration)+' seconds':''}</p><p>${manager?escape(v.publishState)+' · ':''}For members of this studio</p><video id="media-player" controls playsinline preload="none" poster="${escape(v.poster)}" aria-label="${escape(v.title)}" style="width:100%;max-height:60vh"></video><p id="media-status" role="status">Choose Play video to begin.</p><button class="button" data-media-play="${escape(v.id)}">${manager?'Preview video':'Play video'}</button>${manager?`<button class="button secondary" data-media-edit="${escape(v.id)}">Edit details</button><button class="button secondary" data-media-state="${v.publishState==='published'?'unpublish':'publish'}" data-media-id="${escape(v.id)}">${v.publishState==='published'?'Unpublish':'Publish'}</button>`:''}</section>`;
  selected=null;return `<h1>Media Library</h1><p>Practice with your studio, wherever you are.</p>${manager?'<button class="button" data-media-new>Add video</button>':''}<div class="grid">${rows.map(v=>`<article class="card"><img src="${escape(v.poster)}" alt="Practice video" style="width:100%"><h2>${escape(v.title)}</h2><p>${escape(v.creator)}${v.duration?' · '+escape(v.duration)+' seconds':''}</p>${manager?`<p>${escape(v.publishState)}</p>`:''}<button class="button secondary" data-media-open="${escape(v.id)}">View video</button></article>`).join('')||'<p>No videos are available yet. Check back for new studio content.</p>'}</div>`;
 }
 async function click(b){
  if(b.hasAttribute('data-media-back')){release();selected=null;editing=null;render();}
  if(b.hasAttribute('data-media-new')){editing='';render();}
  if(b.dataset.mediaOpen){selected=b.dataset.mediaOpen;editing=null;render();}
  if(b.dataset.mediaEdit){editing=b.dataset.mediaEdit;render();}
  if(b.dataset.mediaState){const v=getData().videos.find(v=>v.id===b.dataset.mediaId);b.disabled=true;try{await mutate('/api/media/'+b.dataset.mediaState,{id:v.id,expectedRevision:v.revision},()=>{});render();}finally{b.disabled=false;}}
  if(b.dataset.mediaPlay){
   release();const current=generation,v=getData().videos.find(v=>v.id===b.dataset.mediaPlay),status=document.querySelector('#media-status');b.disabled=true;
   try{status.textContent='Loading video…';const blob=await api(`/api/media/${encodeURIComponent(v.id)}/play?revision=${v.revision}`,{media:true});if(current!==generation)return;objectUrl=URL.createObjectURL(blob);const player=document.querySelector('#media-player');player.src=objectUrl;player.onerror=()=>{status.textContent='This video could not be played. Return to the library and try again.';release();};await player.play();status.textContent='Playing. Use the player controls to pause or replay.';}
   catch(e){if(current===generation)status.textContent=e.message||'Video unavailable. Return to the library and try again.';}finally{b.disabled=false;}
  }
 }
 async function submit(form){
  const e=getData().videos.find(v=>v.id===editing),values=new FormData(form),file=values.get('asset');
  const body={...(e?{id:e.id,expectedRevision:e.revision}:{}),title:values.get('title'),description:values.get('description'),creator:values.get('creator'),duration:values.get('duration')?Number(values.get('duration')):null};
  if(file?.size){if(file.size>262144)throw Error('Choose an MP4 video up to 256 KB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);body.assetData=btoa(binary);}
  await mutate('/api/media/save',body,()=>{});editing=null;selected=null;render();
 }
 return {html,click,submit,release};
}
