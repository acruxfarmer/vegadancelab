begin;
insert into vega_private.app_members(user_id,tenant_id,business_id,role,participant_ids) values('4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124','layer3-reuse-fixture','willow-movement','staff','{}');
update vega_private.app_state set state=state||'{"entitlementProducts":[{"id":"d1e20fe7-83c2-4bde-a628-2b5b3a714232","name":"Development membership fixture","type":"membership","quantity":1,"validDays":30}]}'::jsonb where tenant_id='layer3-reuse-fixture' and business_id='willow-movement';
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $proof$
declare a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); rid uuid:='5d23202b-538b-4ad0-9bbe-46856932166e'; who uuid:='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124'; d jsonb; m jsonb; cases jsonb:='{}'; original text;
begin
 select md5(document::text) into original from media_private.resources where id=rid;
 d:=jsonb_build_object('id',a,'resourceId',rid,'context',jsonb_build_object('kind','business','tenantId','vega-development','businessId','vega-dance-lab'),'authorized',true,'authorizedBy',who,'authorizedAt',now(),'withdrawnAt',null,'visible',false,'policy',jsonb_build_object('kind','public'),'categoryIds','[]'::jsonb,'collectionIds','[]'::jsonb,'revision',1);
 insert into media_private.placements values(a,rid,'vega-development','vega-dance-lab',who,d);
 d:=d||jsonb_build_object('id',b,'context',jsonb_build_object('kind','business','tenantId','layer3-reuse-fixture','businessId','willow-movement'),'policy',jsonb_build_object('kind','memberships','productIds',jsonb_build_array('d1e20fe7-83c2-4bde-a628-2b5b3a714232')));
 insert into media_private.placements values(b,rid,'layer3-reuse-fixture','willow-movement',who,d);
 update media_private.placements set document=document||'{"visible":true,"revision":2}' where id in(a,b);
 perform set_config('vega.actor_id','e5946b40-9839-4a96-99d5-93262d9573f0',true);
 m:=media_private.viewer_material(b);
 if exists(select 1 from vega_private.app_members where user_id='e5946b40-9839-4a96-99d5-93262d9573f0' and tenant_id='layer3-reuse-fixture' and business_id='willow-movement') then raise exception 'Viewer must not have Willow relationship'; end if;
 cases:=cases||jsonb_build_object('wrongBusiness',jsonb_build_object('placement',m->'placement','resourceAvailable',m->'video' is not null and m->'video'<>'null'::jsonb,'viewerId','e5946b40-9839-4a96-99d5-93262d9573f0'));
 perform set_config('vega.actor_id',who::text,true);
 -- External owner policy stays fixed. A second ALL placement is proved by the
 -- original Vega placement while the restricted Willow placement is withdrawn.
 update media_private.placements set document=document||jsonb_build_object('authorized',false,'visible',false,'withdrawnAt',now(),'revision',3) where id=b;
 m:=media_private.viewer_material(b);
 cases:=cases||jsonb_build_object('withdrawn',jsonb_build_object('placement',m->'placement','resourceAvailable',false));
 m:=media_private.viewer_material(a);
 cases:=cases||jsonb_build_object('independent',jsonb_build_object('placement',m->'placement','resourceAvailable',m->'video' is not null and m->'video'<>'null'::jsonb));
 if (select md5(document::text) from media_private.resources where id=rid)<>original then raise exception 'Canonical resource changed'; end if;
 if (select document->'policy' from media_private.placements where id=a)<>'{"kind":"public"}'::jsonb then raise exception 'Independent policy changed'; end if;
 perform set_config('vega.s3_cases',cases::text,true);
end $proof$;
select current_setting('vega.s3_cases')::jsonb as cases;
rollback;
