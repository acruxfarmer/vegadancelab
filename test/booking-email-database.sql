-- Operator-level functional test only; runtime RLS/ACL checks are separate.
-- All fixtures and verification mutations roll back. No provider requests.
begin;
create temporary table email_baseline as select tenant_id,business_id,md5(state::text) digest,revision from vega_private.app_state;
select set_config('vega.actor_id',(select id::text from auth.users where lower(email)='admin@vegadancelab.com' and email_confirmed_at is not null),'true');
insert into vega_private.app_state(tenant_id,business_id,state) select 'layer4-test',b,jsonb_build_object('customerProfiles',jsonb_build_array(jsonb_build_object('tenantId','layer4-test','businessId',b,'participantId','self','accountId',current_setting('vega.actor_id')))) from unnest(array['vega-email-test','willow-email-test']) b;
insert into vega_private.app_members select current_setting('vega.actor_id')::uuid,'layer4-test',b,'member',array['self'] from unnest(array['vega-email-test','willow-email-test']) b;
insert into vega_private.studio_publications(slug,tenant_id,business_id,name,time_zone) select b,'layer4-test',b,b,'America/Los_Angeles' from unnest(array['vega-email-test','willow-email-test']) b;
insert into vega_private.booking_email_configuration(tenant_id,business_id,sender,origin,enabled,recipient_allowlist) select 'layer4-test',b,'admin@acrux.co','https://vega-development-web.onrender.com',true,array['admin@vegadancelab.com'] from unnest(array['vega-email-test','willow-email-test']) b;
do $$ declare b text; n integer; begin
 foreach b in array array['vega-email-test','willow-email-test'] loop
  perform vega_private.enqueue_booking_email('layer4-test',b,jsonb_build_object('id',b,'kind','booking_confirmation','reservationId','booking','participantId','self','snapshot','{}'::jsonb));
  perform vega_private.enqueue_booking_email('layer4-test',b,jsonb_build_object('id',b,'kind','booking_confirmation','reservationId','booking','participantId','self','snapshot','{}'::jsonb));
 end loop;
 select count(*) into n from vega_private.booking_email_intents where tenant_id='layer4-test';
 if n<>2 then raise exception 'duplicate prevention failed'; end if;
 begin
  perform vega_private.enqueue_booking_email('foreign','foreign','{"id":"foreign","participantId":"self"}'::jsonb);
  raise exception 'foreign scope incorrectly allowed';
 exception when others then if sqlerrm<>'Business access required' then raise; end if; end;
end $$;
do $$ begin
 if exists(select 1 from vega_private.booking_email_intents where tenant_id='layer4-test' and (status<>'intent_created' or recipient<>'admin@vegadancelab.com')) then raise exception 'verified recipient failed'; end if;
end $$;
-- Freeze message; first claim must exclude a simultaneous second claimant for it.
select vega_private.prepare_booking_email('vega-email-test','{"from":"Vega <admin@acrux.co>","to":["admin@vegadancelab.com"],"subject":"Fixture","text":"fixture"}'::jsonb);
do $$ declare first record; second record; begin
 select * into first from vega_private.claim_booking_email('00000000-0000-4000-8000-000000000001');
 if first.id<>'vega-email-test' then raise exception 'claim failed'; end if;
 select * into second from vega_private.claim_booking_email('00000000-0000-4000-8000-000000000002');
 if second.id is not null then raise exception 'leased message reclaimed'; end if;
 perform vega_private.finish_booking_email(first.id,'00000000-0000-4000-8000-000000000001','uncertain',null,'response_unconfirmed');
end $$;
update vega_private.booking_email_intents set available_at=now()-interval '1 minute' where id='vega-email-test';
do $$ declare r record; begin
 select * into r from vega_private.claim_booking_email('00000000-0000-4000-8000-000000000003');
 if r.id<>'vega-email-test' or r.message->>'text'<>'fixture' then raise exception 'retry did not preserve payload'; end if;
 perform vega_private.finish_booking_email(r.id,'00000000-0000-4000-8000-000000000003','provider_accepted','one-provider-email',null);
 if exists(select 1 from vega_private.claim_booking_email('00000000-0000-4000-8000-000000000004')) then raise exception 'accepted message resent'; end if;
end $$;
-- Crash after network I/O: old lease cannot cause a send beyond idempotency window.
update vega_private.booking_email_intents set status='sending',first_attempt_at=now()-interval '25 hours',lease_until=now()-interval '1 minute' where id='vega-email-test';
select * from vega_private.claim_booking_email('00000000-0000-4000-8000-000000000005');
do $$ begin
 if (select status from vega_private.booking_email_intents where id='vega-email-test')<>'needs_review' then raise exception 'expired uncertainty not fenced'; end if;
end $$;
-- Recipient/profile emails cannot override missing verified account linkage.
delete from vega_private.app_members where tenant_id='layer4-test' and business_id='willow-email-test';
insert into vega_private.app_members select current_setting('vega.actor_id')::uuid,'layer4-test','willow-email-test','staff','{}';
select vega_private.enqueue_booking_email('layer4-test','willow-email-test','{"id":"missing-recipient","kind":"booking_confirmation","reservationId":"missing","participantId":"self","snapshot":{}}');
do $$ begin
 if (select status from vega_private.booking_email_intents where id='missing-recipient')<>'needs_review' then raise exception 'missing recipient accepted'; end if;
 if exists(select 1 from email_baseline b join vega_private.app_state a using(tenant_id,business_id) where md5(a.state::text)<>b.digest or a.revision<>b.revision) then raise exception 'unrelated business changed'; end if;
 if has_table_privilege('acrux_booking_email','vega_private.app_state','update') or has_table_privilege('acrux_booking_email','vega_private.app_members','update') then raise exception 'delivery can change booking/member state'; end if;
end $$;
select 'PASS: duplicate, verified linkage, two businesses, foreign scope, lease, uncertain retry, accepted terminal, expired window, missing recipient, read-only booking authority, unrelated state' as result;
rollback;
