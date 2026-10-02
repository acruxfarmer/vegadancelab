-- Prepared installation only. Apply to approved Development project after deployment authorization.
-- No credentials and no payment enablement are installed here.
begin;
create table if not exists vega_private.commerce_provider_binding (
 tenant_id text not null, business_id text not null, binding jsonb not null,
 primary key(tenant_id,business_id),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id),
 check(tenant_id='vega-development' and business_id='vega-dance-lab'),
 check(binding='{"environment":"sandbox","tenantId":"vega-development","businessId":"vega-dance-lab","applicationId":"sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw","merchantId":"MLJGVWY9QZ66R","locationId":"L7EMFD4DPV27P","host":"connect.squareupsandbox.com","currency":"USD"}'::jsonb)
);
alter table vega_private.commerce_provider_binding enable row level security;
alter table vega_private.commerce_provider_binding force row level security;
revoke all on vega_private.commerce_provider_binding from public,anon,authenticated;
grant select on vega_private.commerce_provider_binding to vega_app_runtime;
drop policy if exists commerce_binding_read on vega_private.commerce_provider_binding;
create policy commerce_binding_read on vega_private.commerce_provider_binding for select to vega_app_runtime
 using(exists(select 1 from vega_private.app_members m where m.tenant_id=commerce_provider_binding.tenant_id and m.business_id=commerce_provider_binding.business_id));
insert into vega_private.commerce_provider_binding values('vega-development','vega-dance-lab',
 '{"environment":"sandbox","tenantId":"vega-development","businessId":"vega-dance-lab","applicationId":"sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw","merchantId":"MLJGVWY9QZ66R","locationId":"L7EMFD4DPV27P","host":"connect.squareupsandbox.com","currency":"USD"}'::jsonb)
on conflict do nothing;
do $$ begin
 if not exists(select 1 from vega_private.commerce_provider_binding where tenant_id='vega-development' and business_id='vega-dance-lab'
 and binding='{"environment":"sandbox","tenantId":"vega-development","businessId":"vega-dance-lab","applicationId":"sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw","merchantId":"MLJGVWY9QZ66R","locationId":"L7EMFD4DPV27P","host":"connect.squareupsandbox.com","currency":"USD"}'::jsonb)
 then raise exception 'Conflicting Development payment binding'; end if;
end $$;
commit;
