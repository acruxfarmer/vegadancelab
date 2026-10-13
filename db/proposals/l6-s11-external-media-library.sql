-- S11 additive Development proposal. Apply only through established migration workflow.
begin;
create table media_private.external_media_cache (
 resource_id uuid primary key references media_private.resources(id) on delete restrict,
 tenant_id text not null,business_id text not null,
 provider text not null check(provider in ('vimeo','youtube')),
 media_id text not null,account_id text not null,
 metadata jsonb,expires_at timestamptz not null,
 revision integer not null default 1 check(revision>0),
 unique(tenant_id,business_id,provider,media_id),
 foreign key(tenant_id,business_id,provider) references media_private.source_connections(tenant_id,business_id,provider),
 check(metadata is null or coalesce(jsonb_typeof(metadata)='object' and metadata->>'provider'=provider and metadata->>'id'=media_id and jsonb_typeof(metadata->'eligible')='boolean' and metadata->>'status' in ('eligible','restricted','unavailable'),false))
);
create table media_private.external_media_audit (
 id bigint generated always as identity primary key,
 resource_id uuid not null references media_private.resources(id),
 actor_id uuid references auth.users(id),
 action text not null check(action in ('metadata_refreshed','metadata_expired')),
 revision integer not null,created_at timestamptz not null default now()
);
alter table media_private.external_media_cache enable row level security;
alter table media_private.external_media_audit enable row level security;
create policy external_cache_owner on media_private.external_media_cache to vega_app_runtime
 using(exists(select 1 from media_private.resources r where r.id=resource_id and r.owner_tenant_id=tenant_id and r.owner_business_id=business_id))
 with check(exists(select 1 from media_private.resources r where r.id=resource_id and r.owner_tenant_id=tenant_id and r.owner_business_id=business_id and r.document->>'externalLibrary'='true' and r.document->'source'->>'provider'=provider and r.document->'source'->>'reference'=media_id));
create policy external_audit_actor on media_private.external_media_audit for insert to vega_app_runtime
 with check(actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from media_private.external_media_cache e where e.resource_id=external_media_audit.resource_id));
revoke all on media_private.external_media_cache,media_private.external_media_audit from public,anon,authenticated;
grant select,insert on media_private.external_media_cache to vega_app_runtime;
grant update(metadata,expires_at,revision) on media_private.external_media_cache to vega_app_runtime;
grant insert on media_private.external_media_audit to vega_app_runtime;
grant usage on sequence media_private.external_media_audit_id_seq to vega_app_runtime;

-- Public/member source access uses a narrow projection, not broad resource SELECT.
-- Mirrors the established viewer-material boundary. No credentials/account metadata.
create function media_private.external_viewer_material(placement uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('resource',r.document,'placement',p.document,'cache',jsonb_build_object('metadata',case when e.expires_at>now() then e.metadata else null end,'expires_at',e.expires_at))
 from media_private.placements p join media_private.resources r on r.id=p.resource_id
 join media_private.external_media_cache e on e.resource_id=r.id
 where p.id=placement and p.document->>'authorized'='true' and p.document->>'visible'='true'
 and r.document->>'lifecycle'='active' and
 (p.document->'policy'->>'kind'='public' or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=p.tenant_id and m.business_id=p.business_id));
$$;
create function media_private.external_library_placements(tenant text,business text) returns table(id uuid)
language sql stable security definer set search_path='' as $$
 select p.id from media_private.placements p join media_private.external_media_cache e on e.resource_id=p.resource_id
 where p.tenant_id=tenant and p.business_id=business and p.document->>'authorized'='true' and p.document->>'visible'='true'
 and (p.document->'policy'->>'kind'='public' or exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=tenant and m.business_id=business))
 order by p.id limit 100;
$$;
-- Retention-only cleanup; no network access or provider synchronization.
-- Runs in the existing application lifecycle; deadline is 29 days with hourly cleanup.
create function media_private.expire_external_metadata() returns bigint
language plpgsql security definer set search_path='' as $$
declare removed bigint;
begin
 with expired as (
  update media_private.external_media_cache e set metadata=null,revision=e.revision+1
  where e.metadata is not null and (e.expires_at<=now() or exists(select 1 from media_private.source_connections c where c.tenant_id=e.tenant_id and c.business_id=e.business_id and c.provider=e.provider and (c.document->>'status'='disconnected' or c.document->>'accountId' is distinct from e.account_id)))
  returning e.resource_id,e.revision
 ) insert into media_private.external_media_audit(resource_id,action,revision) select resource_id,'metadata_expired',revision from expired;
 get diagnostics removed=row_count;return removed;
end;
$$;
-- All placement write paths must respect delivery capability, including older APIs.
create function media_private.guard_external_placement() returns trigger
language plpgsql security definer set search_path='' as $$
declare external boolean; eligible boolean;
begin
 select r.document->>'externalLibrary'='true' into external from media_private.resources r where r.id=new.resource_id;
 if external then
  if new.document->'policy'->>'kind' not in ('public','memberships') then raise exception 'External protected paid access is unsupported' using errcode='42501';end if;
  if new.document->>'visible'='true' then
   select e.metadata->>'eligible'='true' and e.expires_at>now() into eligible from media_private.external_media_cache e where e.resource_id=new.resource_id;
   if eligible is distinct from true then raise exception 'External source needs manual refresh or is restricted' using errcode='42501';end if;
  end if;
 end if;return new;
end;
$$;
create trigger external_placement_guard before insert or update on media_private.placements for each row execute function media_private.guard_external_placement();
revoke all on function media_private.external_viewer_material(uuid),media_private.external_library_placements(text,text),media_private.expire_external_metadata(),media_private.guard_external_placement() from public,anon,authenticated;
grant execute on function media_private.external_viewer_material(uuid),media_private.external_library_placements(text,text),media_private.expire_external_metadata() to vega_app_runtime;
commit;
