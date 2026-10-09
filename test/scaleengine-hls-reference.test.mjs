import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveScaleEngineHlsReference as resolve} from '../src/runtime/providers/scaleengine-hls-reference.mjs';
const path='/acruxanalog-vod/play/sestore99/acruxanalog/a.mp4/';
const binding={provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:'https://acruxanalog-vod.secdn.net'+path+'playlist.m3u8'};
test('accepts observed key/pass pair and query-free same-asset references',()=>{
 for(const ref of ['chunk.m3u8','chunk.m3u8?key=k&pass=p','chunk.m3u8?pass=p&key=k',path+'chunk.m3u8?key=k&pass=p'])assert.equal(resolve(binding,ref).pathname,path+'chunk.m3u8');
});
test('unknown, duplicate, encoded, partial and empty queries fail closed',()=>{
 for(const query of ['key=k&pass=p&session=s','key=k&key=x','key=k&pass=p&pass=x','Key=k&pass=p','%6bey=k&pass=p','key=k','key=&pass=p','key=k&pass=',''])assert.throws(()=>resolve(binding,'chunk.m3u8?'+query));
});
test('cross-asset and unrelated origin references remain blocked',()=>{
 for(const ref of ['https://other.example'+path+'chunk.m3u8','http://acruxanalog-vod.secdn.net'+path+'chunk.m3u8','/acruxanalog-vod/play/sestore99/acruxanalog/b.mp4/chunk.m3u8',path.replace('a.mp4/','a.mp4-other/')+'chunk.m3u8'])assert.throws(()=>resolve(binding,ref));
});
test('literal and encoded traversal, userinfo, fragments and backslashes remain blocked',()=>{
 for(const ref of ['../a.mp4/chunk.m3u8','./chunk.m3u8','folder/../chunk.m3u8','%2e%2e/a.mp4/chunk.m3u8','folder%2fchunk.m3u8','folder\\chunk.m3u8','chunk.m3u8#fragment','https://user:password@acruxanalog-vod.secdn.net'+path+'chunk.m3u8'])assert.throws(()=>resolve(binding,ref));
});
test('rejects unready binding and keeps rejection messages credential-free',()=>{
 assert.throws(()=>resolve({...binding,state:'uploading'},'chunk.m3u8'));
 assert.throws(()=>resolve(binding,'chunk.m3u8?unknown=private-value'),e=>!e.message.includes('private-value'));
});
