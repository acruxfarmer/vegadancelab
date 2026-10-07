import {filterMedia,libraryOrganizationUI} from './media-library.js';
export function mediaUI({getData,api,mutate,escape,render}){
 let filters={},managing=false,groupEdit=null,organizeId=null,scope=null;
 let selected=null,editing=null,objectUrl=null,generation=0;
 const release=()=>{generation++;if(objectUrl)URL.revokeObjectURL(objectUrl);objectUrl=null;};
 const canManage=()=>getData()?.context?.role==='staff'&&getData()?.staffAccess?.permissions?.includes('customers.manage');
 const field=(name,label,value='',extra='')=>`<label class="field">${label}<input name="${name}" value="${escape(value)}" ${extra}></label>`;
 function html(){
  release();const d=getData(),rows=d.videos||[],manager=canManage(),currentScope=JSON.stringify([d.context?.tenantId,d.context?.businessId,d.context?.userId]);
  if(scope!==currentScope){scope=currentScope;selected=null;editing=null;filters={};managing=false;groupEdit=null;organizeId=null;}
  const v=rows.find(v=>v.id===selected),org=libraryOrganizationUI({data:d,escape,filters,groupEdit,organizeId});
  if(manager&&groupEdit)return org.editGroup();if(manager&&organizeId)return org.organize();if(manager&&managing)return org.manage();
  if(editing!==null&&manager){const e=rows.find(v=>v.id===editing);return `<h1>${e?'Edit video':'Add video'}</h1><p>Development proof: one small approved MP4, up to 256 KB. Editing returns the video to draft for review.</p><form id="media-edit" class="card">${field('title','Title',e?.title,'required maxlength="160"')}<label class="field">Description<textarea name="description" maxlength="2000">${escape(e?.description||'')}</textarea></label>${field('creator','Instructor / creator',e?.creator,'maxlength="160"')}${field('duration','Duration in seconds (optional)',e?.duration??'','type="number" min="0.1" max="3600" step="0.1"')}<label class="field">Reuse approved studio video<select name="assetSourceId"><option value="">Choose a file below or keep current video</option>${rows.filter(x=>x.assetAvailable).map(x=>`<option value="${escape(x.id)}">${escape(x.title)}</option>`).join('')}</select></label><label class="field">Approved video asset<input name="asset" type="file" accept="video/mp4" ></label><p>Only attach content approved for this business. A practice poster is provided.</p><button class="button">Save draft</button><button type="button" class="button secondary" data-media-back>Back to library</button><p role="alert" id="media-error"></p></form>`;}
  if(v)return `<button class="button secondary" data-media-back>Back to library</button><section class="card"><h1>${escape(v.title)}</h1><p>${escape(v.description)}</p><p>${escape(v.creator)}${v.duration?' · '+escape(v.duration)+' seconds':''}</p><p>${manager?escape(v.publishState)+' · ':''}For members of this studio</p><video id="media-player" controls playsinline preload="none" poster="${escape(v.poster)}" aria-label="${escape(v.title)}" style="width:100%;max-height:60vh"></video><p id="media-status" role="status">Choose Play video to begin.</p><button class="button" data-media-play="${escape(v.id)}">${manager?'Preview video':'Play video'}</button>${manager?`<button class="button secondary" data-media-edit="${escape(v.id)}">Edit details</button><button class="button secondary" data-media-organize="${escape(v.id)}">Organize video</button><button class="button secondary" data-media-state="${v.publishState==='published'?'unpublish':'publish'}" data-media-id="${escape(v.id)}">${v.publishState==='published'?'Unpublish':'Publish'}</button>`:''}</section>`;
  selected=null;const results=filterMedia(rows,filters),group=(d.mediaGroups||[]).find(g=>g.id===filters.collection||g.id===filters.category);
  return `<h1>Media Library</h1><p>Practice with your studio, wherever you are.</p>${manager?'<button class="button" data-media-new>Add video</button><button class="button secondary" data-media-manage>Organize library</button>':''}${org.controls()}${group?'<h2>'+escape(group.name)+'</h2><p>'+escape(group.description)+'</p>':''}<p role="status">${results.length} video${results.length===1?'':'s'}</p><div class="grid">${results.map(v=>`<article class="card"><img src="${escape(v.poster)}" alt="Practice video" style="width:100%"><h2>${escape(v.title)}</h2><p>${escape(v.description)}</p><p>${escape(v.creator)}${v.duration?' · '+escape(v.duration)+' seconds':''}</p><p>${(d.mediaGroups||[]).filter(g=>(v.categoryIds||[]).includes(g.id)).map(g=>escape(g.name)).join(' · ')}</p>${manager?'<p>'+escape(v.publishState)+'</p>':''}${!v.assetAvailable?'<p>Video temporarily unavailable.</p>':''}<button class="button secondary" data-media-open="${escape(v.id)}">View video</button></article>`).join('')||'<p>No videos match this selection. Try clearing the filters, or check back for new studio content.</p>'}</div>`;

 }
 async function click(b){
  if(b.hasAttribute('data-media-manage')){managing=true;groupEdit=null;organizeId=null;render();}
  if(b.dataset.mediaGroupKind){groupEdit={kind:b.dataset.mediaGroupKind};render();}
  if(b.dataset.mediaGroupEdit){const g=getData().mediaGroups.find(g=>g.id===b.dataset.mediaGroupEdit);groupEdit={id:g.id,kind:g.kind};render();}
  if(b.dataset.mediaOrganize){organizeId=b.dataset.mediaOrganize;render();}
  if(b.hasAttribute('data-media-clear')){filters={};render();}
  if(b.hasAttribute('data-media-back')){release();selected=null;editing=null;managing=false;groupEdit=null;organizeId=null;render();}
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
  const fields=new FormData(form);
  if(form.id==='media-search'){filters=Object.fromEntries(fields);render();return;}
  if(form.id==='media-group'){const g=getData().mediaGroups.find(g=>g.id===groupEdit.id);await mutate('/api/media/groups',{...Object.fromEntries(fields),kind:groupEdit.kind,...(g?{id:g.id,expectedRevision:g.revision}:{})},()=>{});groupEdit=null;managing=true;render();return;}
  if(form.id==='media-organize'){const v=getData().videos.find(v=>v.id===organizeId);await mutate('/api/media/organize',{id:v.id,expectedRevision:v.revision,categoryIds:fields.getAll('categoryIds'),collectionIds:fields.getAll('collectionIds')},()=>{});organizeId=null;render();return;}
  const e=getData().videos.find(v=>v.id===editing),values=new FormData(form),file=values.get('asset');
  const body={...(e?{id:e.id,expectedRevision:e.revision}:{}),title:values.get('title'),description:values.get('description'),creator:values.get('creator'),duration:values.get('duration')?Number(values.get('duration')):null};
  if(values.get('assetSourceId'))body.assetSourceId=values.get('assetSourceId');
  if(file?.size){if(file.size>262144)throw Error('Choose an MP4 video up to 256 KB.');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);body.assetData=btoa(binary);}
  await mutate('/api/media/save',body,()=>{});editing=null;selected=null;render();
 }
 return {html,click,submit,release};
}
