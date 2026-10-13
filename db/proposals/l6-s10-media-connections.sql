-- S10 additive Development proposal. Not applied by preparing this file.
-- Uses the established private media schema and restricted application role.
begin;
create table media_private.source_connections (
 tenant_id text not null,
 business_id text not null,
 provider text not null check(provider in ('vimeo','youtube')),
 document jsonb not null,
 primary key(tenant_id,business_id,provider),
 foreign key(tenant_id,business_id) references vega_private.app_state(tenant_id,business_id),
 check(coalesce(document->>'tenantId'=tenant_id and document->>'businessId'=business_id and document->>'provider'=provider,false)),
 check(coalesce((document->>'revision')::integer>0,false)),
 check(coalesce(document->>'status' in ('disconnected','authorizing','verifying','connected','reconnect_required','unavailable'),false))
);
create table media_private.source_connection_audit (
 id bigint generated always as identity primary key,
 tenant_id text not null,business_id text not null,provider text not null,
 actor_id uuid not null references auth.users(id),
 action text not null check(action in ('authorization_started','authorization_consumed','credentials_saved','connection_verified','connection_failed','disconnected','revocation_recorded')),
 revision integer not null check(revision>0),
 created_at timestamptz not null default now(),
 foreign key(tenant_id,business_id,provider) references media_private.source_connections(tenant_id,business_id,provider)
);
revoke all on media_private.source_connections,media_private.source_connection_audit from public,anon,authenticated;
revoke all on sequence media_private.source_connection_audit_id_seq from public,anon,authenticated;
grant select,insert on media_private.source_connections to vega_app_runtime;
grant update(document) on media_private.source_connections to vega_app_runtime;
grant insert on media_private.source_connection_audit to vega_app_runtime;
grant usage on sequence media_private.source_connection_audit_id_seq to vega_app_runtime;
alter table media_private.source_connections enable row level security;
alter table media_private.source_connections force row level security;
alter table media_private.source_connection_audit enable row level security;
alter table media_private.source_connection_audit force row level security;
create policy business_source_connections on media_private.source_connections to vega_app_runtime
 using(exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff' and m.tenant_id=source_connections.tenant_id and m.business_id=source_connections.business_id))
 with check(exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff' and m.tenant_id=source_connections.tenant_id and m.business_id=source_connections.business_id));
create policy business_source_connection_audit on media_private.source_connection_audit for insert to vega_app_runtime
 with check(actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from vega_private.app_members m where m.user_id=actor_id and m.role='staff' and m.tenant_id=source_connection_audit.tenant_id and m.business_id=source_connection_audit.business_id));
commit;
