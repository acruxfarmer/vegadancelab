-- Provider bindings are operator-owned; callbacks cannot choose application scope.
create table vega_private.app_provider_bindings (
 tenant_id text not null,business_id text not null,environment text not null check(environment='sandbox'),
 merchant_id text not null,primary key(environment,merchant_id),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id)
);
alter table vega_private.app_provider_bindings enable row level security;
alter table vega_private.app_provider_bindings force row level security;
revoke all on vega_private.app_provider_bindings from public,anon,authenticated;
grant select on vega_private.app_provider_bindings to vega_app_runtime;
create policy binding_staff on vega_private.app_provider_bindings for select to vega_app_runtime
 using(exists(select 1 from vega_private.app_members m where m.tenant_id=app_provider_bindings.tenant_id and m.business_id=app_provider_bindings.business_id and m.role='staff'));
-- RLS scopes server-side inbox reads; the HTTP API returns only allowlisted job metadata.
grant select on vega_private.square_webhook_inbox,vega_private.square_processing_journal to vega_app_runtime;
create policy inbox_app_staff on vega_private.square_webhook_inbox for select to vega_app_runtime
 using(exists(select 1 from vega_private.app_provider_bindings b where b.environment=square_webhook_inbox.environment and b.merchant_id=square_webhook_inbox.merchant_id));
create policy journal_app_staff on vega_private.square_processing_journal for select to vega_app_runtime
 using(exists(select 1 from vega_private.square_webhook_inbox i where i.event_id=square_processing_journal.event_id));
