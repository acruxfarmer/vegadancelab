-- Additive worker path; preserve intake identity and append-only inbox.
do $$ begin
if not exists(select 1 from pg_roles where rolname='vega_worker_runtime') then
create role vega_worker_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
end if;
end $$;
grant usage on schema vega_private to vega_worker_runtime;
grant select on vega_private.square_webhook_inbox to vega_worker_runtime;
create policy worker_read_inbox on vega_private.square_webhook_inbox for select to vega_worker_runtime using(environment='sandbox');
create table vega_private.square_processing_journal (
event_id text primary key references vega_private.square_webhook_inbox(event_id),
status text not null check(status in ('processed','needs_review')),
reason text, processed_at timestamptz not null default now(),
check((status='processed' and reason is null) or (status='needs_review' and reason is not null))
);
create table vega_private.square_financial_observations (
event_id text primary key references vega_private.square_webhook_inbox(event_id),
environment text not null check(environment='sandbox'), merchant_id text not null,
resource_kind text not null check(resource_kind in ('payment','refund')), resource_id text not null,
observation jsonb not null check(jsonb_typeof(observation)='object'), recorded_at timestamptz not null default now()
);
alter table vega_private.square_processing_journal enable row level security;
alter table vega_private.square_processing_journal force row level security;
alter table vega_private.square_financial_observations enable row level security;
alter table vega_private.square_financial_observations force row level security;
revoke all on vega_private.square_processing_journal,vega_private.square_financial_observations from public,anon,authenticated;
grant select,insert on vega_private.square_processing_journal,vega_private.square_financial_observations to vega_worker_runtime;
create policy worker_journal_read on vega_private.square_processing_journal for select to vega_worker_runtime using(true);
create policy worker_journal_insert on vega_private.square_processing_journal for insert to vega_worker_runtime with check(true);
create policy worker_observation_read on vega_private.square_financial_observations for select to vega_worker_runtime using(environment='sandbox');
create policy worker_observation_insert on vega_private.square_financial_observations for insert to vega_worker_runtime with check(environment='sandbox');
comment on table vega_private.square_financial_observations is 'Immutable sandbox observations, not reconciled financial state or booking authority.';
