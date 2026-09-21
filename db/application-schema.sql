-- Development application authority. Credentials are provisioned through protected handoff.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='vega_app_runtime') then
 create role vega_app_runtime nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
end $$;
grant usage on schema vega_private to vega_app_runtime;
create table vega_private.app_members (
 user_id uuid not null, tenant_id text not null, business_id text not null,
 role text not null check(role in ('member','staff')), participant_ids text[] not null default '{}',
 primary key(user_id,tenant_id,business_id)
);
create table vega_private.app_state (
 tenant_id text not null, business_id text not null, revision bigint not null default 0,
 state jsonb not null check(jsonb_typeof(state)='object'), updated_at timestamptz not null default now(),
 primary key(tenant_id,business_id)
);
create table vega_private.app_commands (
 tenant_id text not null,business_id text not null,actor_id uuid not null,request_id text not null,
 fingerprint text not null,response jsonb not null,created_at timestamptz not null default now(),
 primary key(tenant_id,business_id,actor_id,request_id)
);
alter table vega_private.app_members enable row level security;
alter table vega_private.app_members force row level security;
alter table vega_private.app_state enable row level security;
alter table vega_private.app_state force row level security;
alter table vega_private.app_commands enable row level security;
alter table vega_private.app_commands force row level security;
revoke all on vega_private.app_members,vega_private.app_state,vega_private.app_commands from public,anon,authenticated;
grant select on vega_private.app_members to vega_app_runtime;
grant select,update on vega_private.app_state to vega_app_runtime;
grant select,insert on vega_private.app_commands to vega_app_runtime;
create policy member_identity on vega_private.app_members to vega_app_runtime
 using(user_id::text=current_setting('vega.actor_id',true));
create policy state_scope on vega_private.app_state to vega_app_runtime
 using(exists(select 1 from vega_private.app_members m where m.tenant_id=app_state.tenant_id and m.business_id=app_state.business_id))
 with check(exists(select 1 from vega_private.app_members m where m.tenant_id=app_state.tenant_id and m.business_id=app_state.business_id));
create policy command_scope on vega_private.app_commands to vega_app_runtime
 using(actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from vega_private.app_members m where m.tenant_id=app_commands.tenant_id and m.business_id=app_commands.business_id))
 with check(actor_id::text=current_setting('vega.actor_id',true) and exists(select 1 from vega_private.app_members m where m.tenant_id=app_commands.tenant_id and m.business_id=app_commands.business_id));
comment on table vega_private.app_state is 'Development aggregate; server-authorized transitions serialize per Business. Separate module state and outcomes retained in JSON.';
