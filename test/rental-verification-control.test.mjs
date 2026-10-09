import test from 'node:test';
import assert from 'node:assert/strict';
import {rentalVerification as p,createRentalVerificationControl} from '../src/runtime/rental-verification-control.mjs';
import {createScaleEngineDelivery} from '../src/runtime/providers/scaleengine-delivery.mjs';
const env={VEGA_ENV:'development',RENDER:'true',RENDER_SERVICE_ID:p.serviceId,RENDER_EXTERNAL_HOSTNAME:p.hostname,VEGA_RENTAL_VERIFICATION:p.expiresAt};
const scope={...p,businessOwned:true};
const at=Date.parse(p.expiresAt)-60000;
test('only pinned Development service, full fixture scope and unexpired exact configuration enable verification',()=>{
 assert.equal(createRentalVerificationControl(env,()=>at)(scope).rentalAccessVerified,true);
 for(const key of Object.keys(env))for(const value of [undefined,'', 'invalid'])assert.equal(createRentalVerificationControl({...env,[key]:value},()=>at)(scope).rentalAccessVerified,false,key);
 for(const key of ['actorId','tenantId','businessId','placementId','resourceId','bindingId','entitlementId'])assert.equal(createRentalVerificationControl(env,()=>at)({...scope,[key]:'other'}).rentalAccessVerified,false,key);
 for(const t of [Date.parse(p.expiresAt),Date.parse(p.expiresAt)+1,NaN])assert.equal(createRentalVerificationControl(env,()=>t)(scope).rentalAccessVerified,false);
 assert.equal(createRentalVerificationControl(env,()=>at)({...scope,businessOwned:false}).rentalAccessVerified,false);
 assert.equal(createRentalVerificationControl({...env,VEGA_ENV:'production'},()=>at)(scope).rentalAccessVerified,false);
 assert.equal(createRentalVerificationControl({...env,RENDER_SERVICE_ID:'production-service'},()=>at)(scope).rentalAccessVerified,false);
});
test('real provider adapter gates rental issuance before network and clamps ticket to verification expiry',async(t)=>{
 t.mock.method(Date,'now',()=>at);
 let clock=at,calls=0;
 const control=createRentalVerificationControl(env,()=>clock);
 const adapter=createScaleEngineDelivery({environment:'development',cdnId:'1',apiSecret:'synthetic',rentalVerification:control},async(url,options)=>{calls++;const payload=JSON.parse(options.body);assert.equal(payload.ip,'auto');assert.equal(payload.uses,5);assert.ok(Date.parse(payload.expire_date.replace(' ','T')+'Z')<=Date.parse(p.expiresAt));return Response.json({data:{key:'test-key',pass:'test-pass'}});});
 const binding={provider:'scaleengine',integrationRef:'development-media',state:'ready',assetRef:'/a.mp4',playbackRef:'https://acruxanalog-vod.secdn.net/acruxanalog-vod/play/sestore99/acruxanalog/a.mp4/playlist.m3u8'};
 const rental={verificationScope:scope,deadlineAt:p.expiresAt};
 assert.equal(adapter.rentalCapabilities.rentalAccessVerified,false);
 const result=await adapter.authorize(binding,{rental});assert.equal(calls,1);assert.ok(Date.parse(result.expiresAt)<=Date.parse(p.expiresAt));
 for(const s of [undefined,{...scope,actorId:'other'}])await assert.rejects(adapter.authorize(binding,{rental:{...rental,verificationScope:s}}));
 clock=Date.parse(p.expiresAt);await assert.rejects(adapter.authorize(binding,{rental}));assert.equal(calls,1);
});
