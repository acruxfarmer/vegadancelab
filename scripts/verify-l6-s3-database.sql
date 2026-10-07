begin;
-- Run through the established vega_app_runtime connection.
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $verify$
declare pid uuid:=gen_random_uuid(); eid uuid:=gen_random_uuid(); erid uuid:=gen_random_uuid(); rid uuid:='5d23202b-538b-4ad0-9bbe-46856932166e'; ownerid uuid:='01d4a4c0-9758-4bf4-8561-56232b9c9e4a'; actor uuid:='4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124'; doc jsonb; mat jsonb; oldhash text; blocked boolean:=false;
begin
 begin
 if current_user<>'vega_app_runtime' then raise exception 'Restricted runtime required'; end if;
 select md5(document::text) into oldhash from media_private.resources where id=rid;
 doc:=jsonb_build_object('id',pid,'resourceId',rid,'context',jsonb_build_object('kind','business','tenantId','vega-development','businessId','vega-dance-lab'),'authorized',true,'authorizedBy',actor,'authorizedAt',now(),'withdrawnAt',null,'visible',false,'policy',jsonb_build_object('kind','public'),'categoryIds','[]'::jsonb,'collectionIds','[]'::jsonb,'revision',1);
 insert into media_private.placements values(pid,rid,'vega-development','vega-dance-lab',actor,doc);
 update media_private.placements set document=document||'{"visible":true,"revision":2}' where id=pid;
 perform set_config('vega.actor_id','',true);
 mat:=media_private.viewer_material(pid);
 if mat->'video'->>'publishState' is distinct from 'published' then raise exception 'Public material missing'; end if;
 perform set_config('vega.actor_id',actor::text,true);
 update media_private.placements set document=document||'{"policy":{"kind":"memberships","productIds":["98418cad-59e3-4301-85c0-ec696907d3a2"]},"revision":3}' where id=pid;
 perform set_config('vega.actor_id','',true);
 mat:=media_private.viewer_material(pid);
 if mat->'placement'->'policy'->>'kind' is distinct from 'memberships' then raise exception 'Restricted discovery missing'; end if;
 perform set_config('vega.actor_id',actor::text,true);
 update media_private.placements set document=document||'{"policy":{"kind":"pay_on_demand"},"revision":4}' where id=pid;
 perform set_config('vega.actor_id','',true);
 mat:=media_private.viewer_material(pid);
 if mat->'placement'->'policy'->>'kind' is distinct from 'pay_on_demand' then raise exception 'Pay on demand discovery missing'; end if;
 perform set_config('vega.actor_id',actor::text,true);
 update media_private.placements set document=document||'{"visible":false,"revision":5}' where id=pid;
 perform set_config('vega.actor_id','',true);
 if media_private.viewer_material(pid) is not null then raise exception 'Hidden placement exposed'; end if;
 perform set_config('vega.actor_id',actor::text,true);
 if (select md5(document::text) from media_private.resources where id=rid) is distinct from oldhash then raise exception 'Resource changed'; end if;
 perform set_config('vega.actor_id',ownerid::text,true);
 insert into media_private.resources(id,owner_user_id,submitted_by,document) select erid,ownerid,ownerid,document||jsonb_build_object('id',erid,'lifecycle','active') from media_private.resources where id='1ab5124f-2033-45c2-9902-4b63685d29f5';
 doc:=doc||jsonb_build_object('id',eid,'resourceId',erid,'authorizedBy',ownerid,'policy',jsonb_build_object('kind','pay_on_demand'));
 insert into media_private.placements values(eid,erid,'vega-development','vega-dance-lab',ownerid,doc);
 perform set_config('vega.actor_id',actor::text,true);
 update media_private.placements set document=document||'{"visible":true,"revision":2}' where id=eid;
 begin
 update media_private.placements set document=document||'{"policy":{"kind":"public"},"revision":3}' where id=eid;
 exception when insufficient_privilege then blocked:=true; end;
 if not blocked then raise exception 'External policy edit was accepted'; end if;
 if (select document->'policy'->>'kind' from media_private.placements where id=eid)<>'pay_on_demand' then raise exception 'External policy changed'; end if;
 perform set_config('vega.s3_verification','{"result":"PASS","role":"vega_app_runtime","publicDiscovery":true,"restrictedDiscovery":true,"paidDiscovery":true,"hiddenDenied":true,"sameBusinessEdit":true,"externalEditDenied":true,"externalPolicyPreserved":true,"resourceUnchanged":true}',true);
 exception when others then perform set_config('vega.s3_verification',jsonb_build_object('result','FAIL','code',sqlstate,'message',sqlerrm)::text,true);end;
end $verify$;
select current_setting('vega.s3_verification')::jsonb as result;
rollback;
