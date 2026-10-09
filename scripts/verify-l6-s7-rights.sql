-- Run after proposal in the SAME transaction, then ROLLBACK. No durable fixture.
set local role vega_app_runtime;
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
insert into media_private.placements(id,resource_id,tenant_id,business_id,authorized_by,document)
values('77777777-7777-4777-8777-777777777777','dcb5f610-23a2-43be-af39-706a17be8a92','vega-development','vega-dance-lab','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',
jsonb_build_object('id','77777777-7777-4777-8777-777777777777','resourceId','dcb5f610-23a2-43be-af39-706a17be8a92','context',jsonb_build_object('kind','business','tenantId','vega-development','businessId','vega-dance-lab'),
'authorized',true,'authorizedBy','01d4a4c0-9758-4bf4-8561-56232b9c9e4a','authorizedAt',now()::text,'withdrawnAt',null,'visible',false,'policy',jsonb_build_object('kind','memberships','productIds',jsonb_build_array('98418cad-59e3-4301-85c0-ec696907d3a2')),'categoryIds','[]'::jsonb,'collectionIds','[]'::jsonb,'revision',1));
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $$ begin
 begin
  update media_private.placements set document=document||'{"policy":{"kind":"public"},"revision":2}' where id='77777777-7777-4777-8777-777777777777';
  raise exception 'FAIL legacy broadening accepted';
 exception when insufficient_privilege then null; end;
 update media_private.placements set document=document||'{"visible":true,"revision":2}' where id='77777777-7777-4777-8777-777777777777';
 begin
  update media_private.placements set document=document||jsonb_build_object('revision',3,'rights',jsonb_build_object('present',true,'organize',true,'access',jsonb_build_object('mode','all','ceiling',document->'policy'))) where id='77777777-7777-4777-8777-777777777777';
  raise exception 'FAIL receiver granted own rights';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
update media_private.placements set document=document||jsonb_build_object('revision',3,'rights',jsonb_build_object('present',true,'organize',true,'access',jsonb_build_object('mode','restrict','ceiling',document->'policy'))) where id='77777777-7777-4777-8777-777777777777';
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $$ begin
 begin
  update media_private.placements set document=document||'{"policy":{"kind":"public"},"revision":4}' where id='77777777-7777-4777-8777-777777777777';
  raise exception 'FAIL restrictive ceiling bypass';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
update media_private.placements set document=document||jsonb_build_object('revision',4,'rights',jsonb_build_object('present',true,'organize',true,'access',jsonb_build_object('mode','modes','modes',jsonb_build_array('public'),'ceiling',document->'policy'))) where id='77777777-7777-4777-8777-777777777777';
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
update media_private.placements set document=document||'{"policy":{"kind":"public"},"revision":5}' where id='77777777-7777-4777-8777-777777777777';
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
update media_private.placements set document=document||jsonb_build_object('revision',6,'rights',jsonb_build_object('present',true,'organize',true,'access',jsonb_build_object('mode','none','ceiling',document->'policy'))) where id='77777777-7777-4777-8777-777777777777';
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $$ begin
 begin
  update media_private.placements set document=document||'{"policy":{"kind":"pay_on_demand"},"revision":7}' where id='77777777-7777-4777-8777-777777777777';
  raise exception 'FAIL revoked access edited';
 exception when insufficient_privilege then null; end;
 if not exists(select 1 from media_private.placements where id='77777777-7777-4777-8777-777777777777' and document->>'visible'='true' and document->>'revision'='6') then raise exception 'FAIL placement incoherent'; end if;
end $$;
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
update media_private.placements set document=document||jsonb_build_object('revision',7,'rights',jsonb_build_object('present',false,'organize',false,'access',jsonb_build_object('mode','none','ceiling',document->'policy')),'visible',false) where id='77777777-7777-4777-8777-777777777777';
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $$ begin
 begin
  update media_private.placements set document=document||'{"visible":true,"revision":8}' where id='77777777-7777-4777-8777-777777777777';
  raise exception 'FAIL presentation revocation bypass';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'L6-S7 PostgreSQL delegation guards passed; fixture rolled back' as result;
rollback;
