-- Private, append-only sandbox inbox. Runtime login provisioned separately.
create schema if not exists vega_private;
revoke all on schema vega_private from public, anon, authenticated;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'vega_webhook_ingest') then
    create role vega_webhook_ingest nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end $$;
-- Explicit SET ROLE for operator verification; privileges are not inherited.
grant vega_webhook_ingest to postgres with inherit false;
create table vega_private.square_webhook_inbox (
  event_id text primary key check (length(event_id) between 1 and 255),
  event_type text not null check (event_type in ('payment.created','payment.updated','refund.created','refund.updated')),
  environment text not null default 'sandbox' check (environment = 'sandbox'),
  merchant_id text not null check (length(merchant_id) between 1 and 255),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  constraint event_identity_matches check (
    payload ? 'event_id' and payload ? 'type' and payload ? 'merchant_id'
    and jsonb_typeof(payload -> 'event_id') = 'string'
    and jsonb_typeof(payload -> 'type') = 'string'
    and jsonb_typeof(payload -> 'merchant_id') = 'string'
    and payload ->> 'event_id' = event_id
    and payload ->> 'type' = event_type
    and payload ->> 'merchant_id' = merchant_id
  )
);
alter table vega_private.square_webhook_inbox enable row level security;
alter table vega_private.square_webhook_inbox force row level security;
revoke all on vega_private.square_webhook_inbox from public, anon, authenticated;
grant usage on schema vega_private to vega_webhook_ingest;
grant select, insert on vega_private.square_webhook_inbox to vega_webhook_ingest;
create policy ingest_insert on vega_private.square_webhook_inbox for insert to vega_webhook_ingest with check (environment = 'sandbox');
create policy ingest_deduplicate on vega_private.square_webhook_inbox for select to vega_webhook_ingest using (environment = 'sandbox');
comment on table vega_private.square_webhook_inbox is 'Verified Square sandbox events. Append-only intake; no financial state transitions.';
