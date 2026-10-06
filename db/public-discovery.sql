-- Public discovery is an explicit business publication, never membership impersonation.
-- No source row or existing authenticated policy is changed by this migration.
begin;
create role acrux_public_projection nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema vega_private to acrux_public_projection;
create table vega_private.studio_publications (
 slug text primary key check(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
 tenant_id text not null, business_id text not null,
 published boolean not null default false,
 name text not null, description text not null default '',
 time_zone text not null, visit text not null default '',
 development boolean not null default true,
 class_ids text[] not null default '{}', offer_ids text[] not null default '{}',
 unique(tenant_id,business_id),
 foreign key(tenant_id,business_id) references vega_private.app_state
);
alter table vega_private.studio_publications enable row level security;
alter table vega_private.studio_publications force row level security;
revoke all on vega_private.studio_publications from public,anon,authenticated,vega_app_runtime;
grant select on vega_private.studio_publications,vega_private.app_state to acrux_public_projection;
create policy public_publication_read on vega_private.studio_publications for select to acrux_public_projection using(published);
create policy published_source_read on vega_private.app_state for select to acrux_public_projection
 using(exists(select 1 from vega_private.studio_publications p where p.tenant_id=app_state.tenant_id and p.business_id=app_state.business_id and p.published));

-- Deliberately anonymous, read-only capability. The restricted NOLOGIN owner can
-- read published scopes only. Runtime receives EXECUTE, not access to source rows.
create function vega_private.public_studio_discovery(studio_slug text) returns jsonb
language sql stable security definer set search_path=pg_catalog,vega_private as $$
 select jsonb_build_object(
 'studio',jsonb_build_object('slug',p.slug,'name',p.name,'description',p.description,'timeZone',p.time_zone,'visit',p.visit,'development',p.development),
 'classes',coalesce((select jsonb_agg(jsonb_build_object(
   'id',c->>'id','title',c->>'title','instructor',c->>'instructor','startsAt',c->>'startsAt',
   'creditRequired',c->'creditRequired','waitlistEnabled',c->'waitlistEnabled','duration',c->'duration','location',c->>'location','category',c->>'category','status',c->>'status','capacity',c->'capacity',
   'reservedCount',(select count(*) from jsonb_array_elements(coalesce(a.state->'reservations','[]')) r where r->>'classId'=c->>'id' and r->>'status'='reserved' and (not r ? 'tenantId' or r->>'tenantId'=p.tenant_id) and (not r ? 'businessId' or r->>'businessId'=p.business_id))
 )) from jsonb_array_elements(coalesce(a.state->'classes','[]')) c
 where c->>'id'=any(p.class_ids)
 and (not c ? 'tenantId' or c->>'tenantId'=p.tenant_id)
 and (not c ? 'businessId' or c->>'businessId'=p.business_id)), '[]'),
 'offers',coalesce((select jsonb_agg(jsonb_build_object(
   'id',o->>'id','version',o->'version','productName',o->>'productName','productType',o->>'productType',
   'quantity',o->'quantity','validDays',o->'validDays','categories',o->'categories','classIds',o->'classIds',
   'currency',o->>'currency','priceMinor',o->'priceMinor','taxMinor',o->'tax'->'amountMinor','validityStart',o->>'validityStart'
 )) from jsonb_array_elements(coalesce(a.state->'commerceOffers','[]')) o
 where o->>'id'=any(p.offer_ids) and o->>'tenantId'=p.tenant_id and o->>'businessId'=p.business_id
 and (select count(*) from jsonb_array_elements(coalesce(a.state->'entitlementProducts','[]')) e where e->>'id'=o->>'productId')=1
 and exists(select 1 from jsonb_array_elements(coalesce(a.state->'entitlementProducts','[]')) e
 where e->>'id'=o->>'productId' and e->>'name'=o->>'productName' and e->>'type'=o->>'productType'
 and e->'quantity'=o->'quantity' and e->'validDays'=o->'validDays' and e->'categories'=o->'categories' and e->'classIds'=o->'classIds')), '[]'))
 from vega_private.studio_publications p join vega_private.app_state a using(tenant_id,business_id)
 where p.slug=studio_slug and p.published;
$$;
grant acrux_public_projection to postgres;
grant create on schema vega_private to acrux_public_projection;
alter function vega_private.public_studio_discovery(text) owner to acrux_public_projection;
revoke create on schema vega_private from acrux_public_projection;
revoke all on function vega_private.public_studio_discovery(text) from public,anon,authenticated;
grant execute on function vega_private.public_studio_discovery(text) to vega_app_runtime;
revoke acrux_public_projection from postgres;
commit;
