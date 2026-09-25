-- Additive Development migration. No existing journal record is backfilled or
-- represented as having received an external acknowledgment.
begin;
create role vega_receipt_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema vega_private to vega_receipt_runtime;
create table vega_private.recovery_outbox (
 event_id text primary key check(event_id ~ '^[a-f0-9]{64}$'),
 tenant_id text not null,business_id text not null,actor_id uuid not null,request_id text,
 event_kind text not null default 'business' check(event_kind in ('business','security')),
 previous_revision bigint,revision bigint check(revision=previous_revision+1),
 check((event_kind='business' and request_id is not null and previous_revision is not null and revision is not null) or (event_kind='security' and request_id is null and previous_revision is null and revision is null)),
 payload text not null,payload_digest text not null check(payload_digest ~ '^[a-f0-9]{64}$'),
 state text not null default 'pending' check(state in ('pending','delivering','retry','acknowledged')),
 attempts integer not null default 0,available_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,last_error text,
 object_name text,object_version text,provider_captured_at timestamptz,acknowledged_at timestamptz,
 created_at timestamptz not null default now(),
 unique(tenant_id,business_id,actor_id,request_id),unique(tenant_id,business_id,revision),
 foreign key(tenant_id,business_id,actor_id,request_id) references vega_private.app_commands(tenant_id,business_id,actor_id,request_id),
 check((state='acknowledged')=(acknowledged_at is not null and provider_captured_at is not null and object_name is not null and object_version is not null))
);
alter table vega_private.recovery_outbox enable row level security;
alter table vega_private.recovery_outbox force row level security;
revoke all on vega_private.recovery_outbox from public,anon,authenticated;
grant select on vega_private.recovery_outbox to vega_app_runtime,vega_receipt_runtime;
grant insert(event_id,tenant_id,business_id,actor_id,request_id,event_kind,previous_revision,revision,payload,payload_digest) on vega_private.recovery_outbox to vega_app_runtime;
grant update(state,attempts,available_at,lease_token,lease_until,last_error,object_name,object_version,provider_captured_at,acknowledged_at) on vega_private.recovery_outbox to vega_receipt_runtime;
create policy receipt_app_read on vega_private.recovery_outbox for select to vega_app_runtime using(exists(select 1 from vega_private.app_members m where m.tenant_id=recovery_outbox.tenant_id and m.business_id=recovery_outbox.business_id));
create policy receipt_app_insert on vega_private.recovery_outbox for insert to vega_app_runtime with check(actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from vega_private.app_members m where m.tenant_id=recovery_outbox.tenant_id and m.business_id=recovery_outbox.business_id));
create policy receipt_worker_read on vega_private.recovery_outbox for select to vega_receipt_runtime using(true);
create policy receipt_worker_update on vega_private.recovery_outbox for update to vega_receipt_runtime using(state<>'acknowledged') with check(true);
-- Enforce the atomic boundary even if application code omits the outbox insert.
-- Deferred execution allows state -> local journal -> outbox ordering.
create function vega_private.require_recovery_outbox() returns trigger language plpgsql as $$
begin
 if new.revision<>old.revision+1 then raise exception 'Business revision must advance exactly once'; end if;
 if not exists(select 1 from vega_private.recovery_outbox o where o.tenant_id=new.tenant_id and o.business_id=new.business_id and o.previous_revision=old.revision and o.revision=new.revision and o.actor_id::text=current_setting('vega.actor_id',true)) then
  raise exception 'Business mutation requires atomic independent-receipt outbox intent';
 end if;
 return null;
end $$;
revoke all on function vega_private.require_recovery_outbox() from public;
grant execute on function vega_private.require_recovery_outbox() to vega_app_runtime;
create constraint trigger require_recovery_outbox after update on vega_private.app_state deferrable initially deferred for each row execute function vega_private.require_recovery_outbox();
comment on table vega_private.app_commands is 'Local transactional command journal / idempotency record; NOT an independent recovery receipt.';
comment on table vega_private.recovery_outbox is 'Primary-database delivery intent and acknowledgment metadata. Only the independent B2 artifact is the recovery receipt.';
commit;
