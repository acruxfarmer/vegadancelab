-- Run inside the migration transaction while its existing owner capability is active.
-- This entire fixture section is rolled back before the migration commits.
savepoint reminder_verification;
create temporary table reminder_baseline as select tenant_id,business_id,revision,md5(state::text) digest from vega_private.app_state;
select set_config('vega.reminder_test_user',(select id::text from auth.users where lower(email)='admin@vegadancelab.com' and email_confirmed_at is not null),'true');
do $$ begin if nullif(current_setting('vega.reminder_test_user'),'') is null then raise exception 'Verified test member required'; end if; end $$;
insert into vega_private.app_state(tenant_id,business_id,state)
select 'layer4-reminder-test',b,jsonb_build_object(
 'customerProfiles',jsonb_build_array(jsonb_build_object('tenantId','layer4-reminder-test','businessId',b,'accountId',current_setting('vega.reminder_test_user'),'participantId','self')),
 'participants',jsonb_build_array(jsonb_build_object('id','self','name','Test member')),
 'classes',jsonb_build_array(jsonb_build_object('id','class','title','Movement','instructor','Teacher','status','open','startsAt',now()+interval '24 hours'-interval '30 seconds')),
 'reservations',jsonb_build_array(jsonb_build_object('id','booking','participantId','self','classId','class','status','reserved','createdAt',now()-interval '2 days')),'preferences','[]'::jsonb)
from unnest(array['vega-reminder-test','willow-reminder-test']) b;
insert into vega_private.app_members select current_setting('vega.reminder_test_user')::uuid,'layer4-reminder-test',b,'member',array['self'] from unnest(array['vega-reminder-test','willow-reminder-test']) b;
insert into vega_private.studio_publications(slug,tenant_id,business_id,name,time_zone) select b,'layer4-reminder-test',b,b,'America/Los_Angeles' from unnest(array['vega-reminder-test','willow-reminder-test']) b;
insert into vega_private.booking_email_configuration(tenant_id,business_id,sender,origin,enabled,recipient_allowlist) select 'layer4-reminder-test',b,'admin@acrux.co','https://vega-development-web.onrender.com',true,array['admin@vegadancelab.com'] from unnest(array['vega-reminder-test','willow-reminder-test']) b;
do $$ declare s jsonb;x jsonb;n integer;r record;lease uuid:=gen_random_uuid();begin
 select state into s from vega_private.app_state where tenant_id='layer4-reminder-test' and business_id='vega-reminder-test';
 if vega_private.class_reminder_snapshot(s,'booking','layer4-reminder-test','vega-reminder-test',now()) is null then raise exception 'Default enabled reminder missing'; end if;
 foreach x in array array[
 jsonb_set(s,'{preferences}','[{"participantId":"self","channel":"email","purpose":"class_reminders","allowed":false}]'),
 jsonb_set(s,'{reservations,0,status}','"cancelled"'),jsonb_set(s,'{classes,0,status}','"cancelled"'),
 jsonb_set(s,'{reservations,0,status}','"waitlisted"'),jsonb_set(s,'{reservations,0,createdAt}',to_jsonb(now())),
 jsonb_set(s,'{reservations,0,businessId}','"foreign"'),jsonb_set(s,'{classes,0,startsAt}','"invalid"'),
 jsonb_set(s,'{reservations,0,waitlistHistory}',jsonb_build_array(jsonb_build_object('action','joined'),jsonb_build_object('action','promoted','to','reserved','createdAt',now())))
 ] loop
 if vega_private.class_reminder_snapshot(x,'booking','layer4-reminder-test','vega-reminder-test',now()) is not null then raise exception 'Ineligible reminder selected'; end if;
 end loop;
 if vega_private.class_reminder_snapshot(s,'booking','layer4-reminder-test','vega-reminder-test',now()+interval '6 minutes') is not null then raise exception 'Missed window caught up'; end if;
 x:=jsonb_set(s,'{reservations,0,waitlistHistory}',jsonb_build_array(jsonb_build_object('action','joined'),jsonb_build_object('action','promoted','to','reserved','createdAt',now()-interval '1 day')));
 if vega_private.class_reminder_snapshot(x,'booking','layer4-reminder-test','vega-reminder-test',now()) is null then raise exception 'Early promotion missing'; end if;
 perform * from vega_private.pending_booking_email_messages();perform * from vega_private.pending_booking_email_messages();
 select count(*) into n from vega_private.booking_email_intents where tenant_id='layer4-reminder-test';if n<>2 then raise exception 'Duplicate or cross-business reminder'; end if;
 -- Freeze one payload, then cancel its authoritative class: no dispatch allowed.
 select * into r from vega_private.booking_email_intents where tenant_id='layer4-reminder-test' and business_id='vega-reminder-test';
 perform vega_private.prepare_booking_email(r.id,jsonb_build_object('from','Studio <admin@acrux.co>','to',jsonb_build_array(r.recipient),'subject','Reminder','text','Class reminder'));
 update vega_private.app_state set state=jsonb_set(state,'{classes,0,status}','"cancelled"') where tenant_id='layer4-reminder-test' and business_id='vega-reminder-test';
 perform * from vega_private.claim_booking_email(lease);
 if (select status from vega_private.booking_email_intents where id=r.id)<>'suppressed' then raise exception 'Cancellation suppression failed'; end if;
 -- The other business still gets its own reminder, then uncertainty stops retries.
 select * into r from vega_private.booking_email_intents where tenant_id='layer4-reminder-test' and business_id='willow-reminder-test';
 perform vega_private.prepare_booking_email(r.id,jsonb_build_object('from','Studio <admin@acrux.co>','to',jsonb_build_array(r.recipient),'subject','Reminder','text','Class reminder'));
 perform * from vega_private.claim_booking_email(lease);
 perform vega_private.finish_booking_email(r.id,lease,'uncertain',null,'response_unconfirmed');
 if (select status from vega_private.booking_email_intents where id=r.id)<>'needs_review' then raise exception 'Uncertain reminder retried'; end if;
 select count(*) into n from vega_private.claim_booking_email(gen_random_uuid());if n<>0 then raise exception 'Uncertain reminder dispatched again'; end if;
 -- A new booking identity has its own reminder; the cancelled original remains suppressed.
 update vega_private.app_state set state=jsonb_set(state,'{reservations,0,id}','"rebooking"') where tenant_id='layer4-reminder-test' and business_id='willow-reminder-test';
 perform * from vega_private.pending_booking_email_messages();
 if not exists(select 1 from vega_private.booking_email_intents where tenant_id='layer4-reminder-test' and business_id='willow-reminder-test' and reservation_id='rebooking') then raise exception 'Rebooking reminder missing'; end if;
 -- An unlinked participant creates review state, never an addressed message.
 update vega_private.app_state set state=jsonb_set(jsonb_set(state,'{reservations,0,id}','"unlinked-booking"'),'{customerProfiles}','[]') where tenant_id='layer4-reminder-test' and business_id='willow-reminder-test';
 perform * from vega_private.pending_booking_email_messages();
 if not exists(select 1 from vega_private.booking_email_intents where reservation_id='unlinked-booking' and status='needs_review' and recipient is null) then raise exception 'Unverified recipient selected'; end if;
 if exists(select 1 from reminder_baseline b join vega_private.app_state s using(tenant_id,business_id) where b.revision<>s.revision or b.digest<>md5(s.state::text)) then raise exception 'Existing business mutated'; end if;
end $$;
rollback to savepoint reminder_verification;
