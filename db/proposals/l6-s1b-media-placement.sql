-- Additive Development placement authority. Existing resources and business
-- state remain unchanged. Browser roles have no access to these objects.
begin;
create table media_private.placements (
 id uuid primary key,
 resource_id uuid not null references media_private.resources(id) on delete restrict,
 tenant_id text not null,business_id text not null,
 authorized_by uuid not null references auth.users(id) on delete restrict,
 document jsonb not null,
 unique(resource_id,tenant_id,business_id),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id) on delete restrict,
 check(coalesce(jsonb_typeof(document)='object' and document ?& array['id','resourceId','context','authorized','authorizedBy','authorizedAt','withdrawnAt','visible','policy','categoryIds','collectionIds','revision'],false)),
 check(coalesce(document->>'id'=id::text and document->>'resourceId'=resource_id::text and document->>'authorizedBy'=authorized_by::text,false)),
 check(document->'context'=jsonb_build_object('kind','business','tenantId',tenant_id,'businessId',business_id)),
 check(coalesce(jsonb_typeof(document->'authorized')='boolean' and jsonb_typeof(document->'visible')='boolean' and (document->>'revision')::integer>0,false)),
 check(coalesce((document->>'authorized')::boolean or not (document->>'visible')::boolean,false)),
 check(coalesce(document->'policy'='{"kind":"public"}'::jsonb or (document->'policy'->>'kind'='memberships' and jsonb_typeof(document->'policy'->'productIds')='array' and jsonb_array_length(document->'policy'->'productIds') between 1 and 20),false)),
 check(jsonb_typeof(document->'categoryIds')='array' and jsonb_typeof(document->'collectionIds')='array')
);
create table media_private.placement_audit (
 id bigint generated always as identity primary key,
 placement_id uuid not null references media_private.placements(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('authorized','configured','withdrawn')),
 revision integer not null check(revision>0),created_at timestamptz not null
);
alter table media_private.placements enable row level security;
alter table media_private.placement_audit enable row level security;
-- Explicit ownership predicate in addition to resources' existing RLS. This
-- does not infer ownership from mere visibility/existence of a resource.
create function media_private.placement_owner(resource uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from media_private.resources r where r.id=resource and
  (r.owner_user_id::text=current_setting('vega.actor_id',true) or
   exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
    and m.role='staff' and m.tenant_id=r.owner_tenant_id and m.business_id=r.owner_business_id)));
$$;
create policy placement_read on media_private.placements for select to vega_app_runtime using(
 media_private.placement_owner(resource_id)
 or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=placements.tenant_id and m.business_id=placements.business_id)
 or (document->>'authorized'='true' and document->>'visible'='true' and document->'policy'->>'kind'='public')
);
create policy placement_create on media_private.placements for insert to vega_app_runtime with check(
 authorized_by::text=current_setting('vega.actor_id',true) and media_private.placement_owner(resource_id)
 and exists(select 1 from media_private.resources r where r.id=resource_id and r.document->>'lifecycle'='active')
);
create policy placement_change on media_private.placements for update to vega_app_runtime using(
 media_private.placement_owner(resource_id)
 or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=placements.tenant_id and m.business_id=placements.business_id and m.role='staff')
) with check(
 media_private.placement_owner(resource_id)
 or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=placements.tenant_id and m.business_id=placements.business_id and m.role='staff')
);
create policy placement_audit_insert on media_private.placement_audit for insert to vega_app_runtime with check(
 actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from media_private.placements p where p.id=placement_id and
 (media_private.placement_owner(p.resource_id) or exists(select 1 from vega_private.app_members m
 where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=p.tenant_id and m.business_id=p.business_id and m.role='staff')))
);
-- Owner withdrawal and target configuration have disjoint writable fields.
-- Even trusted runtime SQL cannot let target staff revoke another owner's grant,
-- or let an ordinary owner publish/configure in a business they do not manage.
create function media_private.guard_placement_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target_staff boolean;
begin
 if tg_op='INSERT' then
  if new.document->>'authorized'<>'true' or new.document->>'visible'<>'false' or new.document->>'revision'<>'1'
    or new.document->'policy'<>'{"kind":"public"}'::jsonb or new.document->'withdrawnAt'<>'null'::jsonb then
   raise exception 'New placements require hidden owner authorization' using errcode='42501';
  end if;
  return new;
 end if;
 if new.id<>old.id or new.resource_id<>old.resource_id or new.tenant_id<>old.tenant_id or new.business_id<>old.business_id or new.authorized_by<>old.authorized_by
  or new.document->'authorizedAt' is distinct from old.document->'authorizedAt'
  or (new.document->>'revision')::integer<>(old.document->>'revision')::integer+1 then
  raise exception 'Placement identity and authorization provenance are immutable' using errcode='42501';
 end if;
 if old.document->>'authorized'<>'true' then raise exception 'Withdrawn placement is immutable' using errcode='42501'; end if;
 if new.document->>'authorized'='false' then
  if not media_private.placement_owner(old.resource_id) or new.document->>'visible'<>'false'
   or jsonb_typeof(new.document->'withdrawnAt')<>'string'
   or (new.document-array['authorized','visible','withdrawnAt','revision']) is distinct from (old.document-array['authorized','visible','withdrawnAt','revision']) then
   raise exception 'Only resource owner may withdraw this placement' using errcode='42501';
  end if;
 else
  select exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
   and m.tenant_id=old.tenant_id and m.business_id=old.business_id and m.role='staff') into target_staff;
  if not target_staff or (new.document-array['visible','policy','categoryIds','collectionIds','revision']) is distinct from (old.document-array['visible','policy','categoryIds','collectionIds','revision']) then
   raise exception 'Only target staff may configure local placement fields' using errcode='42501';
  end if;
 end if;
 return new;
end;
$$;
create trigger placement_change_guard before insert or update on media_private.placements for each row execute function media_private.guard_placement_change();
-- Narrow cross-owner lifecycle lookup: returns a boolean, never the resource
-- document/source or business state. Needed because context viewers must NOT gain
-- SELECT/UPDATE authority over an externally owned canonical resource.
create function media_private.placement_resource_active(placement uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 where p.id=placement and p.document->>'authorized'='true' and r.document->>'lifecycle'='active'
 and (r.owner_user_id::text=current_setting('vega.actor_id',true)
  or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and
   ((m.tenant_id=p.tenant_id and m.business_id=p.business_id) or (m.role='staff' and m.tenant_id=r.owner_tenant_id and m.business_id=r.owner_business_id)))
  or (p.document->>'visible'='true' and p.document->'policy'->>'kind'='public')));
$$;
revoke all on media_private.placements,media_private.placement_audit from public,anon,authenticated;
revoke all on sequence media_private.placement_audit_id_seq from public,anon,authenticated;
revoke all on function media_private.placement_resource_active(uuid) from public,anon,authenticated;
revoke all on function media_private.placement_owner(uuid),media_private.guard_placement_change() from public,anon,authenticated;
grant select,insert on media_private.placements to vega_app_runtime;
grant update(document) on media_private.placements to vega_app_runtime;
grant insert on media_private.placement_audit to vega_app_runtime;
grant usage on sequence media_private.placement_audit_id_seq to vega_app_runtime;
grant execute on function media_private.placement_resource_active(uuid) to vega_app_runtime;
grant execute on function media_private.placement_owner(uuid) to vega_app_runtime;
commit;
