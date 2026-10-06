select jsonb_build_object(
'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'owner',r.rolname,'acl',p.proacl::text,'publicExecute',exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE'),'anonExecute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticatedExecute',has_function_privilege('authenticated',p.oid,'EXECUTE'),'runtimeExecute',has_function_privilege('vega_app_runtime',p.oid,'EXECUTE'))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner where n.nspname='vega_private' and p.proname in ('booking_email_recipient','enqueue_booking_email','pending_booking_email_messages','prepare_booking_email','claim_booking_email','finish_booking_email')),
'tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'acl',c.relacl::text,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'publicGrant',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where a.grantee=0),'anonAccess',has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE'),'authenticatedAccess',has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='vega_private' and c.relname in ('booking_email_configuration','booking_email_intents')),
'schemaAcl',(select nspacl::text from pg_namespace where nspname='vega_private'),
'anonSchema',has_schema_privilege('anon','vega_private','USAGE'),
'authenticatedSchema',has_schema_privilege('authenticated','vega_private','USAGE'),
'elevationPresent',pg_has_role('postgres','acrux_booking_email','MEMBER'),
'roleMemberships',(select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname)),'[]') from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname='acrux_booking_email' or m.rolname in ('vega_app_runtime','acrux_booking_email')),
'otherObjectsDigest',(select md5(string_agg(x,'|' order by x)) from (
select c.oid::text||':'||coalesce(c.relacl::text,'') x from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','vega_private') and c.relname not in ('booking_email_configuration','booking_email_intents')
union all select p.oid::text||':'||coalesce(p.proacl::text,'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='vega_private' and p.proname not in ('booking_email_recipient','enqueue_booking_email','pending_booking_email_messages','prepare_booking_email','claim_booking_email','finish_booking_email')
union all select a.attrelid::text||':'||a.attnum::text||':'||coalesce(a.attacl::text,'') from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('auth','vega_private') and c.relname not in ('booking_email_configuration','booking_email_intents')
) q),
'businesses',(select jsonb_agg(jsonb_build_object('tenant',tenant_id,'business',business_id,'revision',revision,'digest',md5(state::text))) from vega_private.app_state),
'intents',(select count(*) from vega_private.booking_email_intents),
'enabledBusinesses',(select count(*) from vega_private.booking_email_configuration where enabled)
) as evidence;
