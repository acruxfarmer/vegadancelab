-- Development only. Additive placement rights; no existing documents rewritten.
begin;
create or replace function media_private.owner_policy_valid(placement uuid, policy jsonb) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 join vega_private.app_state s on s.tenant_id=p.tenant_id and s.business_id=p.business_id
 where p.id=placement and (r.owner_user_id::text=current_setting('vega.actor_id',true) or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff' and m.tenant_id=r.owner_tenant_id and m.business_id=r.owner_business_id))
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

create or replace function media_private.owner_policy_choices(placement uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',e->>'id','name',e->>'name')),'[]'::jsonb)
 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 join vega_private.app_state s on s.tenant_id=p.tenant_id and s.business_id=p.business_id,
 lateral jsonb_array_elements(coalesce(s.state->'entitlementProducts','[]')) e
 where p.id=placement and (r.owner_user_id::text=current_setting('vega.actor_id',true) or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff' and m.tenant_id=r.owner_tenant_id and m.business_id=r.owner_business_id))
 and r.document->>'lifecycle'='active' and p.document->>'authorized'='true' and e->>'type'='membership';
$$;
revoke all on function media_private.owner_policy_choices(uuid) from public,anon,authenticated;
grant execute on function media_private.owner_policy_choices(uuid) to vega_app_runtime;

create function media_private.access_no_broader(p jsonb, boundary jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p=boundary or boundary->>'kind'='public' or
 (p->>'kind'='memberships' and boundary->>'kind'='memberships' and (p->'productIds')<@(boundary->'productIds')),false);
$$;
create function media_private.valid_placement_rights(r jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(r)='object' and r ?& array['present','organize','access']
 and r-array['present','organize','access']='{}'::jsonb
 and jsonb_typeof(r->'present')='boolean' and jsonb_typeof(r->'organize')='boolean'
 and jsonb_typeof(r->'access')='object' and (r->'access') ?& array['mode','ceiling']
 and (r->'access')-array['mode','ceiling','modes']='{}'::jsonb
 and media_private.valid_access_availability(r->'access'->'ceiling')
 and case when r->'access'->>'mode'='modes' then
   case when jsonb_typeof(r->'access'->'modes')='array' then
    jsonb_array_length(r->'access'->'modes') between 1 and 3
    and (r->'access'->'modes')<@'["public","memberships","pay_on_demand"]'::jsonb
    and (select count(distinct x) from jsonb_array_elements(r->'access'->'modes') x)=jsonb_array_length(r->'access'->'modes')
   else false end
 else r->'access'->>'mode' in ('none','restrict','all') and not (r->'access' ? 'modes') end,false);
$$;
create function media_private.delegated_access_allowed(p jsonb, policy jsonb) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(policy=p->'policy' or case p->'rights'->'access'->>'mode'
 when 'all' then true
 when 'modes' then p->'rights'->'access'->'modes' ? (policy->>'kind')
 when 'restrict' then media_private.access_no_broader(policy,p->'rights'->'access'->'ceiling') and media_private.access_no_broader(policy,p->'policy')
 else false end,false);
$$;
revoke all on function media_private.access_no_broader(jsonb,jsonb),media_private.valid_placement_rights(jsonb),media_private.delegated_access_allowed(jsonb,jsonb) from public,anon,authenticated;
grant execute on function media_private.access_no_broader(jsonb,jsonb),media_private.valid_placement_rights(jsonb),media_private.delegated_access_allowed(jsonb,jsonb) to vega_app_runtime;
alter table media_private.placements add constraint placement_rights_valid check(not(document ? 'rights') or media_private.valid_placement_rights(document->'rights'));
alter table media_private.placements add constraint placement_present_required check(not(document ? 'rights') or document->>'visible'='false' or document->'rights'->>'present'='true');
alter table media_private.placement_audit add column details jsonb not null default '{}'::jsonb;
alter table media_private.placement_audit drop constraint placement_audit_action_check;
alter table media_private.placement_audit add constraint placement_audit_action_check check(action in ('authorized','configured','withdrawn','rights_granted','rights_changed','rights_revoked','delegated_access_changed'));

-- The consolidated guard below subsumes the earlier owner-policy-only guard.
create or replace function media_private.guard_owner_policy_change() returns trigger
language plpgsql security invoker set search_path='' as $$ begin return new; end; $$;
create or replace function media_private.guard_placement_change() returns trigger
language plpgsql security invoker set search_path='' as $$
declare is_owner boolean; target_staff boolean; same_business boolean;
begin
 if tg_op='INSERT' then
  if new.document->>'authorized'<>'true' or new.document->>'visible'<>'false' or new.document->>'revision'<>'1' or new.document->'withdrawnAt'<>'null'::jsonb
   or new.document ? 'rights' then raise exception 'New placements require hidden owner authorization' using errcode='42501'; end if;
  return new;
 end if;
 if new.id<>old.id or new.resource_id<>old.resource_id or new.tenant_id<>old.tenant_id or new.business_id<>old.business_id or new.authorized_by<>old.authorized_by
  or new.document->'authorizedAt' is distinct from old.document->'authorizedAt'
  or (new.document->>'revision')::integer<>(old.document->>'revision')::integer+1 then
  raise exception 'Placement identity and authorization provenance are immutable' using errcode='42501'; end if;
 if old.document->>'authorized'<>'true' then raise exception 'Withdrawn placement is immutable' using errcode='42501'; end if;
 is_owner:=media_private.placement_owner(old.resource_id);
 if new.document->>'authorized'='false' then
  if not is_owner or new.document->>'visible'<>'false' or jsonb_typeof(new.document->'withdrawnAt')<>'string'
   or (new.document-array['authorized','visible','withdrawnAt','revision']) is distinct from (old.document-array['authorized','visible','withdrawnAt','revision']) then
   raise exception 'Only resource owner may withdraw this placement' using errcode='42501'; end if;
  return new;
 end if;
 if not media_private.placement_resource_active(old.id) then raise exception 'Placement is inactive' using errcode='42501'; end if;
 if new.document->'rights' is distinct from old.document->'rights' then
  if not is_owner or not media_private.valid_placement_rights(new.document->'rights') then raise exception 'Only owner may grant rights' using errcode='42501'; end if;
  -- Owner policy change can reset its associated ceiling, not other rights.
  if new.document->'policy' is distinct from old.document->'policy' then
   if (new.document-array['policy','rights','revision']) is distinct from (old.document-array['policy','rights','revision'])
    or (new.document->'rights'-'access') is distinct from (old.document->'rights'-'access')
    or (new.document->'rights'->'access'-'ceiling') is distinct from (old.document->'rights'->'access'-'ceiling')
    or new.document->'rights'->'access'->'ceiling' is distinct from new.document->'policy'
    or not media_private.owner_policy_valid(old.id,new.document->'policy') then raise exception 'Invalid owner policy change' using errcode='42501'; end if;
  else
   if (new.document-array['rights','visible','revision']) is distinct from (old.document-array['rights','visible','revision'])
    or new.document->'rights'->'access'->'ceiling' is distinct from old.document->'policy'
    or new.document->'visible' is distinct from (case when new.document->'rights'->>'present'='false' then 'false'::jsonb else old.document->'visible' end) then
    raise exception 'Rights grant cannot change local fields' using errcode='42501'; end if;
  end if;
  return new;
 end if;
 if is_owner and (new.document-array['policy','revision']) is not distinct from (old.document-array['policy','revision'])
  and media_private.owner_policy_valid(old.id,new.document->'policy') then return new; end if;
 select exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
  and m.tenant_id=old.tenant_id and m.business_id=old.business_id and m.role='staff') into target_staff;
 select exists(select 1 from media_private.resources r where r.id=old.resource_id and r.owner_tenant_id=old.tenant_id and r.owner_business_id=old.business_id) into same_business;
 if not target_staff or (new.document-array['visible','policy','categoryIds','collectionIds','revision']) is distinct from (old.document-array['visible','policy','categoryIds','collectionIds','revision']) then
  raise exception 'Only target staff may configure local fields' using errcode='42501'; end if;
 if not same_business and not media_private.delegated_access_allowed(old.document,new.document->'policy') then raise exception 'Owner access boundary exceeded' using errcode='42501'; end if;
 if old.document->'rights'->>'present'='false' and new.document->>'visible'='true' then raise exception 'Presentation not granted' using errcode='42501'; end if;
 if old.document->'rights'->>'organize'='false' and (new.document->'categoryIds' is distinct from old.document->'categoryIds' or new.document->'collectionIds' is distinct from old.document->'collectionIds') then raise exception 'Organization not granted' using errcode='42501'; end if;
 return new;
end;
$$;
commit;

