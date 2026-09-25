-- Remediation 2A. Apply only through the guarded Development rollout.
-- Existing encrypted payloads and original provider acknowledgment lineage survive.
begin;
lock table vega_private.recovery_outbox in access exclusive mode;
alter table vega_private.recovery_outbox
 add column discovery_sequence bigint,
 add column discovery_state text not null default 'pending' check(discovery_state in ('pending','delivering','retry','acknowledged')),
 add column discovery_object_name text,
 add column discovery_object_version text,
 add column discovery_digest text,
 add column discovery_acknowledged_at timestamptz;
update vega_private.recovery_outbox set discovery_sequence=revision where event_kind='business';
with ordered as (
 select event_id,row_number() over(partition by tenant_id,business_id order by created_at,event_id) as n
 from vega_private.recovery_outbox where event_kind='security'
) update vega_private.recovery_outbox o set discovery_sequence=p.n from ordered p where p.event_id=o.event_id;
alter table vega_private.recovery_outbox
 alter column discovery_sequence set not null,
 add constraint discovery_positive check(discovery_sequence>0),
 add constraint discovery_business_revision check(event_kind<>'business' or discovery_sequence=revision),
 add constraint discovery_identity unique(tenant_id,business_id,event_kind,discovery_sequence),
 add constraint discovery_ack_complete check((discovery_state='acknowledged')=(discovery_object_name is not null and discovery_object_version is not null and discovery_digest is not null and discovery_acknowledged_at is not null)),
 add constraint discovery_requires_canonical check(discovery_state<>'acknowledged' or state='acknowledged');
create function vega_private.assign_discovery_sequence() returns trigger language plpgsql as $$
declare prior bigint;
begin
 if new.event_kind='business' and current_setting('vega.receipt_discovery',true) is distinct from 'v1' then
  raise exception 'Deterministic discovery application cutover required';
 end if;
 if new.event_kind='business' then new.discovery_sequence:=new.revision;
 else
  -- Transaction-scoped serialization; MAX is read after the lock is acquired.
  -- No nontransactional sequence is used, so rollback does not consume an ID.
  perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(new.tenant_id,new.business_id,'security')::text,0));
  select discovery_sequence into prior from vega_private.recovery_outbox where event_id=new.event_id;
  if found then new.discovery_sequence:=prior;
  else
   select coalesce(max(discovery_sequence),0)+1 into new.discovery_sequence
   from vega_private.recovery_outbox where tenant_id=new.tenant_id and business_id=new.business_id and event_kind='security';
  end if;
 end if;
 return new;
end $$;
revoke all on function vega_private.assign_discovery_sequence() from public;
grant execute on function vega_private.assign_discovery_sequence() to vega_app_runtime;
create trigger assign_discovery_sequence before insert on vega_private.recovery_outbox for each row execute function vega_private.assign_discovery_sequence();
grant update(discovery_state,discovery_object_name,discovery_object_version,discovery_digest,discovery_acknowledged_at) on vega_private.recovery_outbox to vega_receipt_runtime;
drop policy receipt_worker_update on vega_private.recovery_outbox;
create policy receipt_worker_update on vega_private.recovery_outbox for update to vega_receipt_runtime using(discovery_state<>'acknowledged') with check(true);
comment on column vega_private.recovery_outbox.discovery_sequence is 'Atomic business revision or separate gapless security stream; never a provider receipt by itself.';
comment on column vega_private.recovery_outbox.discovery_state is 'Independent deterministic publication completion, distinct from historical canonical payload upload acknowledgment.';
commit;
