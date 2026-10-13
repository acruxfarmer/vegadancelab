begin;
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
do $proof$
declare n integer;
begin
 if current_user <> 'vega_app_runtime' then raise exception 'wrong runtime role'; end if;
 if has_table_privilege(current_user,'media_private.source_connections','DELETE') or has_table_privilege(current_user,'media_private.source_connection_audit','UPDATE,DELETE') then raise exception 'excess privileges'; end if;
 if has_table_privilege('anon','media_private.source_connections','SELECT') or has_table_privilege('authenticated','media_private.source_connections','SELECT') then raise exception 'browser access'; end if;
 select count(*) into n from media_private.source_connections;
 if n<>0 then raise exception 'existing connection fixture: stop'; end if;
 insert into media_private.source_connections(tenant_id,business_id,provider,document) values('vega-development','vega-dance-lab','vimeo','{"tenantId":"vega-development","businessId":"vega-dance-lab","provider":"vimeo","revision":1,"status":"disconnected"}');
 insert into media_private.source_connection_audit(tenant_id,business_id,provider,actor_id,action,revision) values('vega-development','vega-dance-lab','vimeo','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124','disconnected',1);
 update media_private.source_connections set document=jsonb_set(document,'{revision}','2') where provider='vimeo';
 select count(*) into n from media_private.source_connections where (document->>'revision')::integer=2;
 if n<>1 then raise exception 'owner operation failed'; end if;
 begin
  update media_private.source_connections set business_id='other-business' where provider='vimeo';
  raise exception 'scope column mutation permitted';
 exception when insufficient_privilege then null;
 end;
 perform set_config('vega.actor_id','00000000-0000-4000-8000-000000000001',true);
 select count(*) into n from media_private.source_connections;
 if n<>0 then raise exception 'foreign actor sees connection'; end if;
 update media_private.source_connections set document=jsonb_set(document,'{revision}','3') where provider='vimeo';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'foreign actor modified connection'; end if;
 begin
  insert into media_private.source_connections(tenant_id,business_id,provider,document) values('vega-development','vega-dance-lab','youtube','{"tenantId":"vega-development","businessId":"vega-dance-lab","provider":"youtube","revision":1,"status":"disconnected"}');
  raise exception 'foreign insert permitted';
 exception when insufficient_privilege then null;
 end;
 begin
  insert into media_private.source_connection_audit(tenant_id,business_id,provider,actor_id,action,revision) values('vega-development','vega-dance-lab','vimeo','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124','disconnected',2);
  raise exception 'forged audit actor permitted';
 exception when insufficient_privilege then null;
 end;
 perform set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',true);
 select count(*) into n from media_private.source_connections where (document->>'revision')::integer=2;
 if n<>1 then raise exception 'foreign operation changed connection'; end if;
end $proof$;
rollback;
select set_config('vega.actor_id','4c3dcc3b-34cf-4664-bdf5-e16bbd6cd124',false);
select 'passed' as restricted_role_rollback_proof,(select count(*) from media_private.source_connections) as remaining_connections,not has_table_privilege(current_user,'media_private.source_connection_audit','SELECT') as audit_read_denied;
