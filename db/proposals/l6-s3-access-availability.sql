-- Development only; explicit policy, safe discovery, no business-state migration.
begin;
create function media_private.valid_access_availability(policy jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(policy in ('{"kind":"public"}'::jsonb,'{"kind":"pay_on_demand"}'::jsonb)
 or (policy->>'kind'='memberships' and jsonb_typeof(policy->'productIds')='array'
 and (policy - array['kind','productIds'])='{}'::jsonb
 and case when jsonb_typeof(policy->'productIds')='array' then jsonb_array_length(policy->'productIds') between 1 and 20 else false end),false);
$$;
revoke all on function media_private.valid_access_availability(jsonb) from public,anon,authenticated;
grant execute on function media_private.valid_access_availability(jsonb) to vega_app_runtime;
alter table media_private.placements drop constraint placements_document_check3;
alter table media_private.placements add constraint placements_access_availability_check check(media_private.valid_access_availability(document->'policy'));
create or replace function media_private.viewer_material(placement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p media_private.placements; r media_private.resources; source_state jsonb; video jsonb; related boolean;
begin
 select * into p from media_private.placements where id=placement for share;
 if not found then return null; end if;
 related:=exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=p.tenant_id and m.business_id=p.business_id);
 if p.document->>'authorized'<>'true' or p.document->>'visible'<>'true' then return null; end if;
 select * into r from media_private.resources where id=p.resource_id for share;
 if not found or r.document->>'lifecycle'<>'active' or r.document->'source'->>'kind'<>'legacy_video'
  or r.document->'source'->>'provider'<>'business-media' then return jsonb_build_object('placement',p.document); end if;
 -- Exact canonical compatibility link; caller cannot choose an asset or business.
 if not exists(select 1 from media_private.legacy_media_links l where l.resource_id=r.id and l.tenant_id=r.owner_tenant_id
  and l.business_id=r.owner_business_id and l.video_id=r.document->'source'->>'reference') then return jsonb_build_object('placement',p.document); end if;
 select state into source_state from vega_private.app_state where tenant_id=r.owner_tenant_id and business_id=r.owner_business_id for share;
 select v into video from jsonb_array_elements(coalesce(source_state->'videos','[]')) v
  where v->>'id'=r.document->'source'->>'reference' and v->>'tenantId'=r.owner_tenant_id and v->>'businessId'=r.owner_business_id and v->>'publishState'='published';
 if video is null then return case when related then jsonb_build_object('placement',p.document) else null end; end if;
 return jsonb_build_object('placement',p.document,'video',video);
end;
$$;

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
