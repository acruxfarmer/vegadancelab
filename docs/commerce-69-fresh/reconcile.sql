-- Read-only independent reconciliation. Run only against cjdoczrxcjynjhgpgqop.
-- Compare baseline.json and infrastructure-baseline.json; no provider or state writes.
select revision,
 md5(state::text) state_digest,
 md5((state - 'purchaseDrafts' - 'paymentAttempts' - 'activity')::text) unaffected_state_digest,
 (select jsonb_object_agg(key,md5(value::text)) from jsonb_each(state)) component_digests,
 (select jsonb_agg(jsonb_build_object('id',d->>'id','digest',md5(d::text))) from jsonb_array_elements(state->'purchaseDrafts') d where d->>'requestId' <> 'fresh69-20261002-draft') original_purchases,
 (select jsonb_agg(jsonb_build_object('id',a->>'id','digest',md5(a::text))) from jsonb_array_elements(state->'paymentAttempts') a where a->>'id'='e81f8bc6-b0f8-4896-9708-69db493030c0') historical_attempt,
 (select jsonb_agg(d) from jsonb_array_elements(state->'purchaseDrafts') d where d->>'requestId'='fresh69-20261002-draft') fresh_purchases,
 (select jsonb_agg(a) from jsonb_array_elements(state->'paymentAttempts') a where a->>'id'<>'e81f8bc6-b0f8-4896-9708-69db493030c0') fresh_attempts,
 jsonb_array_length(state->'activity') activity_count,
 (select md5(jsonb_agg(a order by n)::text) from jsonb_array_elements(state->'activity') with ordinality x(a,n) where n<=116) original_activity_digest,
 (select jsonb_agg(a order by n) from jsonb_array_elements(state->'activity') with ordinality x(a,n) where n>116) appended_activity,
 (select count(*) from vega_private.app_commands where tenant_id='vega-development' and business_id='vega-dance-lab') commands_count,
 (select md5(coalesce(jsonb_agg(to_jsonb(c) order by request_id),'[]'::jsonb)::text) from vega_private.app_commands c where tenant_id='vega-development' and business_id='vega-dance-lab' and request_id not in ('fresh69-20261002-draft','fresh69-20261002-shared','fresh69-20261002-distinct')) original_commands_digest,
 (select jsonb_agg(jsonb_build_object('requestId',c.request_id,'fingerprint',c.fingerprint,'response',c.response,'operationId',o.event_id,'previousRevision',o.previous_revision,'revision',o.revision,'receiptState',o.discovery_state) order by o.revision) from vega_private.app_commands c join vega_private.recovery_outbox o using(tenant_id,business_id,actor_id,request_id) where c.tenant_id='vega-development' and c.business_id='vega-dance-lab' and c.request_id in ('fresh69-20261002-draft','fresh69-20261002-shared','fresh69-20261002-distinct')) fresh_commands,
 (select count(*) from vega_private.recovery_outbox where tenant_id='vega-development' and business_id='vega-dance-lab') outbox_count,
 (select jsonb_agg(jsonb_build_object('integration_ref',integration_ref,'selected',selected)) from vega_private.payment_integrations where tenant_id='vega-development' and business_id='vega-dance-lab') integrations,
 (select count(*) from vega_private.square_webhook_inbox) inbox_count,
 (select md5(coalesce(jsonb_agg(to_jsonb(i) order by event_id),'[]'::jsonb)::text) from vega_private.square_webhook_inbox i) inbox_digest,
 (select count(*) from vega_private.square_processing_journal) journal_count,
 (select md5(coalesce(jsonb_agg(to_jsonb(j) order by event_id),'[]'::jsonb)::text) from vega_private.square_processing_journal j) journal_digest
from vega_private.app_state where tenant_id='vega-development' and business_id='vega-dance-lab';
