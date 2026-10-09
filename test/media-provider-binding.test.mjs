import test from 'node:test';
import assert from 'node:assert/strict';
import {newMediaResource} from '../src/media-resource.mjs';
import {newMediaProviderBinding,transitionMediaProviderBinding as move,requireReadyMediaBinding,mediaBindingStatus} from '../src/media-provider-binding.mjs';
const resource=()=>newMediaResource({owner:{kind:'user',userId:'owner'},title:'Disposable',creator:'Development',source:{kind:'managed_reference',provider:'acrux-managed',reference:'ingestion-1'}},'owner');
const binding=r=>newMediaProviderBinding(r,{provider:'scaleengine',integrationRef:'development-media'});
test('provider replacement preserves canonical resource, ownership and provenance',()=>{
 const r=resource(),before=structuredClone(r),a=binding(r),b=newMediaProviderBinding(r,{provider:'second-test-provider',integrationRef:'second-development'});
 assert.equal(a.resourceId,b.resourceId);assert.notEqual(a.id,b.id);assert.notEqual(r.id,a.id);assert.deepEqual(r,before);assert.equal(r.source.provider,'acrux-managed');
});
test('upload completion is not readiness; readiness requires provider asset and playback reference',()=>{
 const r=resource();let b=binding(r);
 assert.throws(()=>move(b,1,'ready'));
 b=move(b,1,'uploading');b=move(b,2,'processing',{assetRef:'/disposable.mp4'});
 assert.throws(()=>requireReadyMediaBinding(r,b));assert.throws(()=>move(b,3,'ready'));
 b=move(b,3,'ready',{playbackRef:'private-playback-binding'});assert.equal(requireReadyMediaBinding(r,b),b);
 assert.deepEqual(mediaBindingStatus(b),{state:'ready',revision:4});
 assert.throws(()=>requireReadyMediaBinding({...r,lifecycle:'archived'},b));
 assert.throws(()=>requireReadyMediaBinding({...r,id:'other'},b));
});
test('stale observations cannot advance state or replace asset identity',()=>{
 let b=binding(resource());b=move(b,1,'uploading');b=move(b,2,'processing',{assetRef:'/one.mp4'});
 assert.throws(()=>move(b,2,'failed'));assert.throws(()=>move(b,3,'ready',{assetRef:'/other.mp4',playbackRef:'private'}));
});
test('failure and deletion are explicit, with no automatic reupload or resurrection',()=>{
 let b=binding(resource());b=move(b,1,'uploading');b=move(b,2,'failed');assert.throws(()=>move(b,3,'uploading'));
 b=move(b,3,'deleting');b=move(b,4,'deleted');assert.equal(b.assetRef,null);assert.throws(()=>move(b,5,'uploading'));
});
test('external references cannot accidentally become native provider bindings',()=>{
 const r=resource();r.source.kind='external_reference';assert.throws(()=>binding(r));
});
