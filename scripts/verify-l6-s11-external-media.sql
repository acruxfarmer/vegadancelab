-- Development only, rolled-back fixture. No credentials selected or provider calls.
begin;
-- Existing Development owner fixture used by the established S10 verifier.
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $$
declare actor uuid:=current_setting('vega.actor_id')::uuid; conn record; rid uuid:=gen_random_uuid(); pid uuid:=gen_random_uuid(); r jsonb; p jsonb; denied boolean;
begin
 if current_user<>'vega_app_runtime' then raise exception 'Restricted runtime required';end if;
 select tenant_id,business_id,provider,document->>'accountId' as account into conn from media_private.source_connections where provider='youtube' and document->>'status'='connected' limit 1;
 if conn.account is null then raise exception 'Existing authorized Development connection missing';end if;
 r:=jsonb_build_object('id',rid,'mediaType','video','owner',jsonb_build_object('kind','business','tenantId',conn.tenant_id,'businessId',conn.business_id),'title','S11 rollback fixture','creator','','submittedBy',actor,'source',jsonb_build_object('kind','external_reference','provider',conn.provider,'reference','S11test00001'),'lifecycle','active','revision',1,'createdAt',now(),'externalLibrary',true,'presentationEdited',true);
 insert into media_private.resources(id,owner_tenant_id,owner_business_id,submitted_by,document) values(rid,conn.tenant_id,conn.business_id,actor,r);
 insert into media_private.external_media_cache(resource_id,tenant_id,business_id,provider,media_id,account_id,metadata,expires_at) values(rid,conn.tenant_id,conn.business_id,conn.provider,'S11test00001',conn.account,jsonb_build_object('provider','youtube','id','S11test00001','title','Temporary API title','eligible',true,'status','eligible'),now()+interval '1 day');
 p:=jsonb_build_object('id',pid,'resourceId',rid,'context',jsonb_build_object('kind','business','tenantId',conn.tenant_id,'businessId',conn.business_id),'authorized',true,'authorizedBy',actor,'authorizedAt',now(),'withdrawnAt',null,'visible',false,'policy',jsonb_build_object('kind','public'),'categoryIds','[]'::jsonb,'collectionIds','[]'::jsonb,'revision',1);
 insert into media_private.placements(id,resource_id,tenant_id,business_id,authorized_by,document) values(pid,rid,conn.tenant_id,conn.business_id,actor,p);
 if media_private.external_viewer_material(pid) is not null then raise exception 'Hidden placement exposed';end if;
 denied:=false;
 begin update media_private.placements set document=jsonb_set(jsonb_set(document,'{policy}','{"kind":"pay_on_demand"}'),'{revision}','2') where id=pid;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Unsupported paid policy accepted';end if;
 update media_private.placements set document=jsonb_set(jsonb_set(document,'{visible}','true'),'{revision}','2') where id=pid;
 if media_private.external_viewer_material(pid) is null then raise exception 'Explicit public publication unavailable';end if;
 denied:=false;
 begin insert into media_private.external_media_cache(resource_id,tenant_id,business_id,provider,media_id,account_id,metadata,expires_at) values(rid,conn.tenant_id,conn.business_id,conn.provider,'S11test00001',conn.account,null,now());
 exception when unique_violation then denied:=true;end;
 if not denied then raise exception 'Duplicate accepted';end if;
 update media_private.external_media_cache set expires_at=now()-interval '1 second' where resource_id=rid;
 perform media_private.expire_external_metadata();
 if exists(select 1 from media_private.external_media_cache where resource_id=rid and metadata is not null) then raise exception 'Expired API metadata retained';end if;
 if (select document from media_private.resources where id=rid) is distinct from r then raise exception 'Expiry changed canonical resource';end if;
 if (select document->>'visible' from media_private.placements where id=pid)<>'true' then raise exception 'Expiry changed publication';end if;
 denied:=false;
 begin update media_private.placements set document=jsonb_set(document,'{revision}','3') where id=pid;
 exception when insufficient_privilege then denied:=true;end;
 if not denied then raise exception 'Expired source publication accepted';end if;
 perform set_config('vega.actor_id','00000000-0000-4000-8000-000000000001',true);
 if exists(select 1 from media_private.external_media_cache where resource_id=rid) then raise exception 'Outsider read source cache';end if;
 if has_table_privilege('authenticated','media_private.external_media_cache','SELECT') or has_function_privilege('authenticated','media_private.external_viewer_material(uuid)','EXECUTE') then raise exception 'Browser private access granted';end if;
end;
$$;
select 'PASS: hidden, explicit public publication, unsupported paid denial, duplicate constraint, actual metadata deletion, canonical preservation, publication preservation, expired-source denial, outsider cache isolation, browser denial' as verification;
rollback;
