-- Development adapter registration only; apply AFTER commerce-69-integrations.sql on authorization.
-- Retains commerce_provider_binding and all historical attempt snapshots unchanged.
begin;
insert into vega_private.payment_integrations(tenant_id,business_id,integration_id,version,integration_ref,selected)
select tenant_id,business_id,'vega-development-card',1,
 '{"id":"vega-development-card","version":1,"tenantId":"vega-development","businessId":"vega-dance-lab","provider":"square","environment":"sandbox"}'::jsonb,true
from vega_private.commerce_provider_binding
where binding='{"environment":"sandbox","tenantId":"vega-development","businessId":"vega-dance-lab","applicationId":"sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw","merchantId":"MLJGVWY9QZ66R","locationId":"L7EMFD4DPV27P","host":"connect.squareupsandbox.com","currency":"USD"}'::jsonb;
do $$ begin
 if not exists(select 1 from vega_private.payment_integrations where tenant_id='vega-development' and business_id='vega-dance-lab' and integration_id='vega-development-card' and version=1 and selected and integration_ref='{"id":"vega-development-card","version":1,"tenantId":"vega-development","businessId":"vega-dance-lab","provider":"square","environment":"sandbox"}'::jsonb) then raise exception 'Verified Development integration registration missing'; end if;
end $$;
commit;
