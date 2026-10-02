-- Prepared only: neutral, versioned integration registry. No activation or credential storage.
begin;
create table vega_private.payment_integrations (
 tenant_id text not null,
 business_id text not null,
 integration_id text not null,
 version integer not null check(version>0),
 integration_ref jsonb not null,
 selected boolean not null default false,
 primary key(tenant_id,business_id,integration_id,version),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id),
 check(integration_ref->>'tenantId'=tenant_id and integration_ref->>'businessId'=business_id and integration_ref->>'id'=integration_id and (integration_ref->>'version')::integer=version),
 check(integration_ref ?& array['tenantId','businessId','id','version','provider','environment']),
 check(integration_ref - array['tenantId','businessId','id','version','provider','environment']='{}'::jsonb),
 check(jsonb_typeof(integration_ref->'provider')='string' and length(integration_ref->>'provider')>0),
 check(jsonb_typeof(integration_ref->'environment')='string' and integration_ref->>'environment' in ('sandbox','production')),
 check(jsonb_typeof(integration_ref->'tenantId')='string' and jsonb_typeof(integration_ref->'businessId')='string' and jsonb_typeof(integration_ref->'id')='string' and jsonb_typeof(integration_ref->'version')='number')
);
create unique index payment_integration_selected on vega_private.payment_integrations(tenant_id,business_id) where selected;
alter table vega_private.payment_integrations enable row level security;
alter table vega_private.payment_integrations force row level security;
revoke all on vega_private.payment_integrations from public,anon,authenticated;
grant select on vega_private.payment_integrations to vega_app_runtime;
create policy payment_integration_read on vega_private.payment_integrations for select to vega_app_runtime
 using(exists(select 1 from vega_private.app_members m where m.tenant_id=payment_integrations.tenant_id and m.business_id=payment_integrations.business_id));
create function vega_private.preserve_payment_integration_version() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception 'Integration history must be retained'; end if;
 if new.integration_ref is distinct from old.integration_ref or new.tenant_id<>old.tenant_id or new.business_id<>old.business_id or new.integration_id<>old.integration_id or new.version<>old.version then raise exception 'Integration version is immutable'; end if;
 return new;
end $$;
revoke all on function vega_private.preserve_payment_integration_version() from public,anon,authenticated;
create trigger immutable_payment_integration before update or delete on vega_private.payment_integrations for each row execute function vega_private.preserve_payment_integration_version();
commit;
