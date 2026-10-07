-- L6-S1A additive Development schema proposal; NOT APPLIED.
-- Review/apply through the established Development migration workflow only.
-- No new role, no provider execution, no change to existing objects/grants.
begin;
create schema media_private;
revoke all on schema media_private from public,anon,authenticated;
create table media_private.resources (
 id uuid primary key,
 owner_user_id uuid references auth.users(id) on delete restrict,
 owner_tenant_id text,
 owner_business_id text,
 submitted_by uuid not null references auth.users(id) on delete restrict,
 document jsonb not null,
 check (jsonb_typeof(document)='object' and document ?& array['id','submittedBy','owner','mediaType','lifecycle','revision','title','creator','source','createdAt']),
 foreign key(owner_tenant_id,owner_business_id) references vega_private.app_state(tenant_id,business_id) on delete restrict,
 check ((owner_user_id is not null and owner_tenant_id is null and owner_business_id is null) or
        (owner_user_id is null and owner_tenant_id is not null and owner_business_id is not null)),
 check (coalesce(document->>'id'=id::text and document->>'submittedBy'=submitted_by::text,false)),
 check (coalesce(document->>'mediaType'='video' and document->>'lifecycle' in ('active','archived'),false)),
 check (coalesce((document->>'revision')::integer>0,false)),
 check (jsonb_typeof(document->'source')='object' and (document->'source') ?& array['kind','provider','reference']),
 check (document->'owner'=case when owner_user_id is not null then jsonb_build_object('kind','user','userId',owner_user_id::text)
   else jsonb_build_object('kind','business','tenantId',owner_tenant_id,'businessId',owner_business_id) end)
);
create table media_private.legacy_media_links (
 tenant_id text not null,business_id text not null,video_id text not null,
 resource_id uuid not null references media_private.resources(id) on delete restrict,
 primary key(tenant_id,business_id,video_id),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id) on delete restrict
);
create index legacy_media_resource on media_private.legacy_media_links(resource_id);
create table media_private.resource_audit (
 id bigint generated always as identity primary key,
 resource_id uuid not null references media_private.resources(id) on delete restrict,
 actor_id uuid not null references auth.users(id) on delete restrict,
 action text not null check(action in ('resource_created','legacy_adopted','resource_archived')),
 revision integer not null check(revision>0),created_at timestamptz not null default now()
);
revoke all on all tables in schema media_private from public,anon,authenticated;
revoke all on all sequences in schema media_private from public,anon,authenticated;
-- Trusted application adapter performs resource/business authorization before
-- reading or mutating; browser roles have no schema or object access.
grant usage on schema media_private to vega_app_runtime;
grant select,insert on media_private.resources to vega_app_runtime;
grant update(document) on media_private.resources to vega_app_runtime;
grant select,insert on media_private.legacy_media_links to vega_app_runtime;
grant insert on media_private.resource_audit to vega_app_runtime;
grant usage on sequence media_private.resource_audit_id_seq to vega_app_runtime;
alter table media_private.resources enable row level security;
alter table media_private.legacy_media_links enable row level security;
alter table media_private.resource_audit enable row level security;
create policy owned_resource_adapter on media_private.resources to vega_app_runtime
 using(owner_user_id::text=current_setting('vega.actor_id',true) or exists(
  select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
   and m.tenant_id=owner_tenant_id and m.business_id=owner_business_id and m.role='staff'))
 with check(owner_user_id::text=current_setting('vega.actor_id',true) or exists(
  select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true)
   and m.tenant_id=owner_tenant_id and m.business_id=owner_business_id and m.role='staff'));
-- The established application permission resolver further narrows staff access
-- to customers.manage; no new business role or assignment is created.
create policy owned_legacy_adapter on media_private.legacy_media_links to vega_app_runtime
 using(exists(select 1 from media_private.resources r where r.id=resource_id
  and r.owner_tenant_id=tenant_id and r.owner_business_id=business_id))
 with check(exists(select 1 from media_private.resources r where r.id=resource_id
  and r.owner_tenant_id=tenant_id and r.owner_business_id=business_id));
create policy trusted_resource_audit on media_private.resource_audit for insert to vega_app_runtime with check(actor_id::text=current_setting('vega.actor_id',true));
commit;
