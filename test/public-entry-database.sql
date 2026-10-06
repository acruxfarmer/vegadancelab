-- All fixture changes are rolled back. No production or existing business writes.
begin;
insert into auth.users(id,email,email_confirmed_at,is_anonymous) values
 ('a1300000-0000-4000-8000-000000000001','layer3-new@example.invalid',now(),false),
 ('a1300000-0000-4000-8000-000000000002','layer3-collision@example.invalid',now(),false),
 ('a1300000-0000-4000-8000-000000000003','layer3-unconfirmed@example.invalid',null,false);
insert into vega_private.app_state(tenant_id,business_id,state) values
 ('layer3-test-a','studio-a','{"classes":[{"id":"shared","title":"Vega fixture class","instructor":"A teacher","startsAt":"2099-01-01T18:00:00Z","duration":60,"capacity":3,"status":"open","category":"Movement","privateNote":"SECRET"},{"id":"hidden","title":"PRIVATE CLASS"},{"id":"foreign","tenantId":"layer3-test-b","businessId":"studio-b","title":"FOREIGN CLASS"}],"reservations":[{"id":"private-booking","classId":"shared","participantId":"PRIVATE PERSON","status":"reserved","attendanceStatus":"PRIVATE"}],"participants":[{"id":"existing","name":"Existing person"}],"customerProfiles":[{"tenantId":"layer3-test-a","businessId":"studio-a","accountId":"other","participantId":"existing","fields":{"contactEmail":"layer3-collision@example.invalid"}}],"entitlementProducts":[{"id":"p","name":"Three visits","type":"class_pack","quantity":3,"validDays":30,"categories":["Movement"],"classIds":[]}],"commerceOffers":[{"id":"pass","tenantId":"layer3-test-a","businessId":"studio-a","productId":"p","productName":"Three visits","productType":"class_pack","quantity":3,"validDays":30,"categories":["Movement"],"classIds":[],"priceMinor":6000,"currency":"USD","tax":{"amountMinor":0},"version":1,"validityStart":"confirmed_payment","privatePolicy":"SECRET"}],"purchaseDrafts":[{"id":"PRIVATE PURCHASE"}],"activity":[]}'),
 ('layer3-test-b','studio-b','{"classes":[{"id":"shared","title":"Willow fixture class","startsAt":"2099-01-01T18:00:00Z","capacity":4,"status":"cancelled"}],"participants":[],"reservations":[],"activity":[]}');
insert into vega_private.studio_publications(slug,tenant_id,business_id,published,name,time_zone,class_ids,offer_ids,onboarding_enabled) values
 ('layer3-fixture-a','layer3-test-a','studio-a',true,'Vega fixture','America/Los_Angeles',array['shared','foreign'],array['pass'],true),
 ('layer3-fixture-b','layer3-test-b','studio-b',true,'Willow fixture','America/New_York',array['shared'],array[]::text[],true);
grant vega_app_runtime to postgres;
set local role vega_app_runtime;
do $$ declare a jsonb; b jsonb; r jsonb; original text; begin
 a:=vega_private.public_studio_discovery('layer3-fixture-a');b:=vega_private.public_studio_discovery('layer3-fixture-b');
 if a->'classes'->0->>'title'<>'Vega fixture class' or b->'classes'->0->>'title'<>'Willow fixture class' then raise exception 'Business isolation failed'; end if;
 if jsonb_array_length(a->'classes')<>1 or a::text ~ 'PRIVATE|SECRET|FOREIGN|attendance|purchaseDrafts' then raise exception 'Public data leak'; end if;
 if a->'classes'->0->>'reservedCount'<>'1' or a->'offers'->0->>'priceMinor'<>'6000' then raise exception 'Source projection mismatch'; end if;
 if vega_private.public_studio_discovery('missing') is not null then raise exception 'Unknown studio exposed'; end if;
 if exists(select 1 from vega_private.app_state) then raise exception 'Anonymous raw state exposed'; end if;
 if has_table_privilege(current_user,'vega_private.app_members','INSERT') then raise exception 'Runtime can assign arbitrary members'; end if;
 if has_function_privilege('anon','vega_private.onboard_public_member(text,text,text)','EXECUTE') then raise exception 'Anonymous bootstrap executable'; end if;
 perform set_config('vega.actor_id','a1300000-0000-4000-8000-000000000003',true);
 r:=vega_private.onboard_public_member('layer3-fixture-a','Unconfirmed',null);
 if r->>'status'<>'verification_required' then raise exception 'Unverified user onboarded'; end if;
 perform set_config('vega.actor_id','a1300000-0000-4000-8000-000000000002',true);
 r:=vega_private.onboard_public_member('layer3-fixture-a','Collision','layer3-collision@example.invalid');
 if r->>'status'<>'needs_staff_review' or exists(select 1 from vega_private.app_members) then raise exception 'Ambiguous email linked'; end if;
 perform set_config('vega.actor_id','a1300000-0000-4000-8000-000000000001',true);
 r:=vega_private.onboard_public_member('layer3-fixture-a','New fixture member','layer3-new@example.invalid');
 if r->>'status'<>'ready' or r->>'created'<>'true' then raise exception 'New member bootstrap failed'; end if;
 original:=r->>'participantId';
 if (select count(*) from vega_private.app_members where role='member' and participant_ids=array[original])<>1 then raise exception 'Membership mismatch'; end if;
 r:=vega_private.onboard_public_member('layer3-fixture-a','New fixture member','layer3-new@example.invalid');
 if r->>'created'<>'false' or r->>'participantId'<>original then raise exception 'Retry duplicated membership'; end if;
 if exists(select 1 from vega_private.app_state where business_id='studio-b') then raise exception 'Member can read foreign business'; end if;
 r:=vega_private.onboard_public_member('layer3-fixture-b','New fixture member','layer3-new@example.invalid');
 if r->>'status'<>'ready' or r->>'participantId'=original then raise exception 'Second business linkage not independent'; end if;
end $$;
reset role;
select 'PASS: public isolation, explicit publication, offer match, no raw anonymous state, confirmed self onboarding, ambiguous review, retry and independent second business' as result;
rollback;
