-- Development only. Owner-only policy validation; no private state disclosure.
begin;
create function media_private.owner_policy_valid(placement uuid, policy jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 join vega_private.app_state s on s.tenant_id=p.tenant_id and s.business_id=p.business_id
 where p.id=placement and r.owner_user_id::text=current_setting('vega.actor_id',true)
 and r.document->>'lifecycle'='active' and p.document->>'authorized'='true'
 and (policy in ('{"kind":"public"}'::jsonb,'{"kind":"pay_on_demand"}'::jsonb)
 or (policy->>'kind'='memberships' and (policy-array['kind','productIds'])='{}'::jsonb
 and case when jsonb_typeof(policy->'productIds')='array' then
 jsonb_array_length(policy->'productIds') between 1 and 20
 and (select count(distinct v) from jsonb_array_elements(policy->'productIds') v)=jsonb_array_length(policy->'productIds')
 and not exists(select 1 from jsonb_array_elements(policy->'productIds') v where jsonb_typeof(v)<>'string'
 or (select count(*) from jsonb_array_elements(coalesce(s.state->'entitlementProducts','[]')) e where e->>'type'='membership' and e->'id'=v)<>1)
 else false end)));
$$;
revoke all on function media_private.owner_policy_valid(uuid,jsonb) from public,anon,authenticated;
grant execute on function media_private.owner_policy_valid(uuid,jsonb) to vega_app_runtime;

create function media_private.owner_policy_choices(placement uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name')),'[]'::jsonb)
 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 join vega_private.app_state s on s.tenant_id=p.tenant_id and s.business_id=p.business_id,
 lateral jsonb_array_elements(coalesce(s.state->'entitlementProducts','[]')) e
 where p.id=placement and r.owner_user_id::text=current_setting('vega.actor_id',true)
 and r.document->>'lifecycle'='active' and p.document->>'authorized'='true' and e->>'type'='membership';
$$;
revoke all on function media_private.owner_policy_choices(uuid) from public,anon,authenticated;
grant execute on function media_private.owner_policy_choices(uuid) to vega_app_runtime;

-- Runs ahead of the established local-field guard only for the exact approved
-- personal-owner policy change. All other changes retain the existing guard.
create function media_private.guard_owner_policy_change() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.document->'policy' is distinct from old.document->'policy'
 and exists(select 1 from media_private.resources r where r.id=old.resource_id and r.owner_user_id::text=current_setting('vega.actor_id',true)) then
  if new.id<>old.id or new.resource_id<>old.resource_id or new.tenant_id<>old.tenant_id or new.business_id<>old.business_id or new.authorized_by<>old.authorized_by
  or (new.document-array['policy','revision']) is distinct from (old.document-array['policy','revision'])
  or (new.document->>'revision')::integer<>(old.document->>'revision')::integer+1
  or not media_private.owner_policy_valid(old.id,new.document->'policy') then
   raise exception 'Only valid owner Access Availability changes are allowed' using errcode='42501';
  end if;
 end if;
 return new;
end;
$$;
revoke all on function media_private.guard_owner_policy_change() from public,anon,authenticated;
create trigger owner_policy_change_guard before update on media_private.placements for each row execute function media_private.guard_owner_policy_change();
alter table media_private.resource_audit drop constraint resource_audit_action_check;
alter table media_private.resource_audit add constraint resource_audit_action_check check(action in ('resource_created','legacy_adopted','resource_archived','metadata_edited'));
create or replace function media_private.guard_placement_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare target_staff boolean;
begin
 if tg_op='INSERT' then
  if new.document->>'authorized'<>'true' or new.document->>'visible'<>'false' or new.document->>'revision'<>'1'
 or new.document->'withdrawnAt'<>'null'::jsonb then
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
  if exists(select 1 from media_private.resources r where r.id=old.resource_id and r.owner_user_id::text=current_setting('vega.actor_id',true))
   and (new.document-array['policy','revision']) is not distinct from (old.document-array['policy','revision'])
   and media_private.owner_policy_valid(old.id,new.document->'policy') then return new; end if;
  if new.document->'policy' is distinct from old.document->'policy' and not exists(
   select 1 from media_private.resources r where r.id=old.resource_id
   and r.owner_tenant_id=old.tenant_id and r.owner_business_id=old.business_id
  ) then raise exception 'External owner access policy is immutable in this slice' using errcode='42501'; end if;
  select exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
   and m.tenant_id=old.tenant_id and m.business_id=old.business_id and m.role='staff') into target_staff;
  if not target_staff or (new.document-array['visible','policy','categoryIds','collectionIds','revision']) is distinct from (old.document-array['visible','policy','categoryIds','collectionIds','revision']) then
   raise exception 'Only target staff may configure local placement fields' using errcode='42501';
  end if;
 end if;
 return new;
end;
$$;


commit;

