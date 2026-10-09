import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createApplicationApi} from '../src/runtime/refund-application-api.mjs';
import {createMediaOwnerManagement} from '../src/runtime/media-owner-management.mjs';
const owner='01d4a4c0-9758-4bf4-8561-56232b9c9e4a';
test('owner management uses verified principal without any staff or business headers',async()=>{
 let captured;const api=createApplicationApi({SUPABASE_URL:'https://cjdoczrxcjynjhgpgqop.supabase.co',SUPABASE_PUBLISHABLE_KEY:'public'},{mediaOwnerManagement:async(id,input)=>{captured={id,input};return {items:[]};}},async()=>({ok:true,json:async()=>({id:owner,is_anonymous:false,user_metadata:{role:'staff'}})}));
 const req=Readable.from([Buffer.from(JSON.stringify({action:'archive',id:owner,expectedRevision:1}))]);req.url='/api/media-management';req.method='POST';req.headers={authorization:'Bearer token','content-type':'application/json','x-vega-business':'forged'};
 let status,body;await api(req,{writeHead:s=>status=s,end:b=>body=JSON.parse(b)});
 assert.equal(status,200);assert.equal(captured.id,owner);assert.equal(captured.input.action,'archive');assert.deepEqual(body,{items:[]});
});
test('owner list and business choices apply server authorization and omit business state',async()=>{
 const owned={id:owner,owner:{kind:'user',userId:owner},title:'Mine',source:{kind:'external_reference',provider:'example',reference:'sample'},lifecycle:'active'};
 const foreign={...owned,id:'foreign',owner:{kind:'user',userId:'other'}};
 const queries=[];const manage=createMediaOwnerManagement({connect:async()=>({release(){},async query(sql){queries.push(sql);if(sql.startsWith('select document from media_private.resources'))return {rows:[{document:owned},{document:foreign}]};return {rows:[]};}})});
 const result=await manage(owner);assert.equal(result.items.length,1);assert.equal(result.items[0].title,'Mine');assert.deepEqual(result.businesses,[]);assert.equal(result.state,undefined);assert.equal(queries.at(-1),'commit');
});
test('management rejects unauthenticated identities before connecting and rolls back invalid actions',async()=>{
 let calls=0;const log=[];const manage=createMediaOwnerManagement({connect:async()=>{calls++;return {release(){log.push('released');},query:async sql=>{log.push(sql);return {rows:[]};}};}});
 await assert.rejects(manage(''),/Sign in/);assert.equal(calls,0);
 await assert.rejects(manage(owner,{action:'transfer',id:owner,expectedRevision:1}),/Unsupported/);assert.deepEqual(log.slice(-2),['rollback','released']);
});

test('receiving UI projection exposes only delegated controls and refresh reflects revocation',async()=>{
 const actor='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',context={kind:'business',tenantId:'development',businessId:'receiver'};
 const placement={id:owner,resourceId:'external',context,authorized:true,visible:true,policy:{kind:'memberships',productIds:['m1']},revision:1};
 const state={entitlementProducts:[{id:'m1',name:'One',type:'membership'},{id:'m2',name:'Two',type:'membership'}],mediaGroups:[]};
 const manage=createMediaOwnerManagement({connect:async()=>({release(){},async query(sql){
  if(sql.includes('select m.tenant_id'))return {rows:[{tenant_id:context.tenantId,business_id:context.businessId,role:'staff',state}]};
  if(sql==='select document from media_private.placements order by id')return {rows:[{document:placement}]};
  return {rows:[]};
 }})},{initialOwners:[{userId:actor,tenantId:context.tenantId,businessId:context.businessId}]});
 let result=await manage(actor),p=result.items[0].placements[0];
 assert.equal(result.items[0].localOnly,true);assert.equal(p.canEditAccess,false);assert.equal(p.canOrganize,true);assert.deepEqual(p.allowedAccessModes,[]);
 placement.rights={present:true,organize:false,access:{mode:'restrict',ceiling:placement.policy}};
 p=(await manage(actor)).items[0].placements[0];assert.equal(p.canOrganize,false);assert.equal(p.canEditAccess,true);assert.deepEqual(p.allowedAccessModes,['memberships']);assert.deepEqual(p.products.map(x=>x.id),['m1']);
 placement.rights.access={mode:'modes',modes:['public'],ceiling:placement.policy};p=(await manage(actor)).items[0].placements[0];assert.deepEqual(p.allowedAccessModes,['public']);
 placement.rights.access.mode='none';p=(await manage(actor)).items[0].placements[0];assert.equal(p.canEditAccess,false);
 assert.equal(result.items[0].source.reference,undefined);assert.equal(result.state,undefined);
});

test('rental-only delegate sees scoped corrections without gaining media ownership or metadata authority',async()=>{
 const context={kind:'business',tenantId:'development',businessId:'receiver'},placement={id:owner,resourceId:'resource',context,authorized:true,visible:true,policy:{kind:'pay_on_demand'},revision:1};
 const state={staffRoleAssignments:[{...context,userId:owner,role:'front_desk',rentalPermissions:['rentals.correct']}],accessEntitlements:[{id:'grant',principalId:'viewer',tenantId:context.tenantId,businessId:context.businessId,target:{id:owner},state:'active',rental:{availableAt:'2026-01-01T00:00:00Z',startBy:'2099-01-01T00:00:00Z'},corrections:[]},{id:'foreign',principalId:'other',tenantId:'other',businessId:context.businessId,target:{id:owner},rental:{}}],mediaAvailability:[{placementId:owner,tenantId:context.tenantId,businessId:context.businessId,status:'suspended',revision:2}]};
 const manage=createMediaOwnerManagement({connect:async()=>({release(){},async query(sql){if(sql.includes('select m.tenant_id'))return {rows:[{tenant_id:context.tenantId,business_id:context.businessId,role:'staff',state}]};if(sql==='select document from media_private.placements order by id')return {rows:[{document:placement}]};return {rows:[]};}})});
 const result=await manage(owner),p=result.items[0].placements[0];assert.equal(result.items[0].localOnly,true);assert.equal(p.canEditAccess,false);assert.equal(p.canOrganize,false);assert.equal(p.rental.canConfigure,false);assert.equal(p.rental.canCorrect,true);assert.equal(p.rental.availability,'suspended');assert.deepEqual(p.rental.entitlements.map(g=>g.id),['grant']);assert.deepEqual(result.businesses,[]);
});
