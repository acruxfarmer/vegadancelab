begin;
grant vega_app_runtime to postgres with inherit false, set true;
insert into vega_private.app_members(user_id,tenant_id,business_id,role,participant_ids) values
('11111111-1111-4111-8111-111111112109','smoke-2109-a','business-a','member',array['participant-a']),
('22222222-2222-4222-8222-222222222109','smoke-2109-b','business-b','staff',array['participant-b']);
insert into vega_private.app_state(tenant_id,business_id,state) values
('smoke-2109-a','business-a','{"synthetic":true}'),('smoke-2109-b','business-b','{"synthetic":true}');
set local role vega_app_runtime;
select set_config('vega.actor_id','11111111-1111-4111-8111-111111112109',true);
do $$ declare n integer; begin
 select count(*) into n from vega_private.app_members; if n<>1 then raise exception 'MEMBERSHIP_ISOLATION_FAILED'; end if;
 select count(*) into n from vega_private.app_state; if n<>1 then raise exception 'STATE_ISOLATION_FAILED'; end if;
 update vega_private.app_state set revision=revision+1 where tenant_id='smoke-2109-b';
 get diagnostics n=row_count; if n<>0 then raise exception 'CROSS_SCOPE_UPDATE_FAILED'; end if;
 update vega_private.app_state set revision=revision+1 where tenant_id='smoke-2109-a';
 get diagnostics n=row_count; if n<>1 then raise exception 'OWN_SCOPE_UPDATE_FAILED'; end if;
 begin update vega_private.app_members set role='staff'; raise exception 'ROLE_ESCALATION_ALLOWED'; exception when insufficient_privilege then null; end;
 begin delete from vega_private.app_state; raise exception 'DELETE_ALLOWED'; exception when insufficient_privilege then null; end;
 begin update vega_private.app_state set tenant_id='smoke-2109-x'; raise exception 'TENANT_REASSIGN_ALLOWED'; exception when insufficient_privilege then null; end;
 insert into vega_private.app_commands values('smoke-2109-a','business-a','11111111-1111-4111-8111-111111112109','synthetic-receipt','fingerprint','{}',now());
 begin update vega_private.app_commands set fingerprint='changed'; raise exception 'AUDIT_UPDATE_ALLOWED'; exception when insufficient_privilege then null; end;
 begin insert into vega_private.app_commands values('smoke-2109-a','business-a','22222222-2222-4222-8222-222222222109','forged','f','{}',now()); raise exception 'FORGED_ACTOR_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
select set_config('vega.actor_id','22222222-2222-4222-8222-222222222109',true);
do $$ declare n integer; begin
 select count(*) into n from vega_private.app_state where tenant_id='smoke-2109-a'; if n<>0 then raise exception 'ACTOR_SWITCH_LEAK'; end if;
 select count(*) into n from vega_private.app_commands; if n<>0 then raise exception 'RECEIPT_LEAK'; end if;
end $$;
select set_config('vega.actor_id','33333333-3333-4333-8333-333333332109',true);
do $$ declare n integer; begin select count(*) into n from vega_private.app_state; if n<>0 then raise exception 'UNASSIGNED_READ_ALLOWED'; end if; end $$;
reset role;
select 'PASS: synthetic actor/scope/privilege checks completed; rollback follows' as result;
rollback;
