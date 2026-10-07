-- Fixed 24-hour reminder projection. No business records are written.
begin;
do $$ begin if exists(select 1 from vega_private.booking_email_configuration where enabled) then raise exception 'Delivery must be disabled during deployment'; end if; end $$;
alter table vega_private.booking_email_intents drop constraint booking_email_intents_kind_check;
alter table vega_private.booking_email_intents add constraint booking_email_intents_kind_check check(kind in ('booking_confirmation','booking_cancellation','rebooking_confirmation','waitlist_promotion','class_cancelled','waitlist_joined','waitlist_removed','class_reminder'));
alter table vega_private.booking_email_intents drop constraint booking_email_intents_status_check;
alter table vega_private.booking_email_intents add constraint booking_email_intents_status_check check(status in ('intent_created','sending','uncertain','provider_accepted','delivered','failed','needs_review','suppressed'));
create function vega_private.class_reminder_snapshot(s jsonb,rid text,t text,b text,at_time timestamptz) returns jsonb
language plpgsql immutable set search_path=pg_catalog as $$
declare r jsonb;c jsonb;p jsonb;pref jsonb;starts timestamptz;due timestamptz;confirmed timestamptz;n integer;
begin
 select count(*),jsonb_agg(x)->0 into n,r from jsonb_array_elements(coalesce(s->'reservations','[]')) x where x->>'id'=rid;
 if n<>1 or r->>'status'<>'reserved' or coalesce(r->>'tenantId',t)<>t or coalesce(r->>'businessId',b)<>b then return null; end if;
 select count(*),jsonb_agg(x)->0 into n,c from jsonb_array_elements(coalesce(s->'classes','[]')) x where x->>'id'=r->>'classId';
 if n<>1 or c->>'status'<>'open' or coalesce(c->>'tenantId',t)<>t or coalesce(c->>'businessId',b)<>b then return null; end if;
 starts:=(c->>'startsAt')::timestamptz;due:=starts-interval '24 hours';
 -- Five-minute processing tolerance, never a late catch-up campaign.
 if starts is null or at_time<due or at_time>=due+interval '5 minutes' then return null; end if;
 confirmed:=(r->>'createdAt')::timestamptz;
 if exists(select 1 from jsonb_array_elements(coalesce(r->'waitlistHistory','[]')) x where x->>'action'='joined') then
  select max((x->>'createdAt')::timestamptz) into confirmed from jsonb_array_elements(coalesce(r->'waitlistHistory','[]')) x where x->>'action'='promoted' and x->>'to'='reserved';
 end if;
 if confirmed is null or confirmed>due then return null; end if;
 select count(*),jsonb_agg(x)->0 into n,pref from jsonb_array_elements(coalesce(s->'preferences','[]')) x where x->>'participantId'=r->>'participantId' and x->>'channel'='email' and x->>'purpose'='class_reminders';
 if n>1 or (n=1 and (pref->'allowed' is distinct from 'true'::jsonb or coalesce(pref->>'tenantId',t)<>t or coalesce(pref->>'businessId',b)<>b)) then return null; end if;
 select count(*),jsonb_agg(x)->0 into n,p from jsonb_array_elements(coalesce(s->'participants','[]')) x where x->>'id'=r->>'participantId';
 if n<>1 or coalesce(p->>'tenantId',t)<>t or coalesce(p->>'businessId',b)<>b then return null; end if;
 return jsonb_build_object('className',c->>'title','startsAt',c->>'startsAt','instructor',coalesce(c->>'instructor',''),'memberName',p->>'name','status','reserved','reminderWindow','24h');
exception when others then return null;
end $$;
revoke all on function vega_private.class_reminder_snapshot(jsonb,text,text,text,timestamptz) from public,anon,authenticated,vega_app_runtime;
grant execute on function vega_private.class_reminder_snapshot(jsonb,text,text,text,timestamptz) to acrux_booking_email;
-- Existing non-login communication owner only, within this transaction.
grant acrux_booking_email to postgres with inherit true;
create or replace function vega_private.pending_booking_email_messages() returns table(id text,kind text,snapshot jsonb,configuration jsonb,recipient text)
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
 insert into vega_private.booking_email_intents(id,tenant_id,business_id,reservation_id,participant_id,kind,snapshot,configuration,recipient,account_id,status,reason)
 select 'reminder:'||md5(jsonb_build_array(s.tenant_id,s.business_id,r->>'id','24h')::text),s.tenant_id,s.business_id,r->>'id',r->>'participantId','class_reminder',snap.body,
 jsonb_build_object('name',p.name,'timeZone',p.time_zone,'slug',p.slug,'tenantId',s.tenant_id,'businessId',s.business_id,'sender',cfg.sender,'origin',cfg.origin),recipient.email,recipient.account_id,
 case when recipient.email is null then 'needs_review' else 'intent_created' end,case when recipient.email is null then 'verified_self_recipient_required' end
 from vega_private.app_state s join vega_private.booking_email_configuration cfg using(tenant_id,business_id)
 join vega_private.studio_publications p using(tenant_id,business_id)
 cross join lateral jsonb_array_elements(coalesce(s.state->'reservations','[]')) r
 cross join lateral (select vega_private.class_reminder_snapshot(s.state,r->>'id',s.tenant_id,s.business_id,now()) body) snap
 left join lateral vega_private.booking_email_recipient(s.tenant_id,s.business_id,r->>'participantId') recipient on true
 where cfg.enabled and snap.body is not null
 on conflict on constraint booking_email_intents_tenant_id_business_id_reservation_id__key do nothing;
 return query select i.id,i.kind,i.snapshot,i.configuration,i.recipient from vega_private.booking_email_intents i join vega_private.booking_email_configuration c using(tenant_id,business_id)
 where i.status='intent_created' and i.message is null and c.enabled and i.recipient=any(c.recipient_allowlist) order by i.created_at limit 25;
end $$;
create or replace function vega_private.claim_booking_email(lease uuid) returns table(id text,message jsonb)
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
 update vega_private.booking_email_intents i set status='needs_review',reason='reminder_outcome_uncertain',lease_token=null,lease_until=null
 where i.kind='class_reminder' and (i.status='uncertain' or (i.status='sending' and i.lease_until<now()));
 update vega_private.booking_email_intents i set status='suppressed',reason='reminder_no_longer_eligible'
 where i.kind='class_reminder' and i.status='intent_created' and not exists(select 1 from vega_private.app_state s where s.tenant_id=i.tenant_id and s.business_id=i.business_id and vega_private.class_reminder_snapshot(s.state,i.reservation_id,i.tenant_id,i.business_id,now())=i.snapshot);

 update vega_private.booking_email_intents i set status='needs_review',reason='retry_window_or_limit_exhausted',lease_token=null,lease_until=null
 where i.status in ('sending','uncertain') and (i.lease_until is null or i.lease_until<now()) and (i.first_attempt_at<=now()-interval '23 hours' or i.attempts>=5);
 update vega_private.booking_email_intents i set status='needs_review',reason='verified_recipient_changed'
 where i.status in ('intent_created','uncertain','sending') and (i.lease_until is null or i.lease_until<now())
 and not exists(select 1 from vega_private.booking_email_recipient(i.tenant_id,i.business_id,i.participant_id) r where r.email=i.recipient and r.account_id=i.account_id);
 return query with candidate as (
 select i.id from vega_private.booking_email_intents i join vega_private.booking_email_configuration c using(tenant_id,business_id)
 where i.status in ('intent_created','uncertain','sending') and i.message is not null and i.available_at<=now()
 and c.enabled and i.recipient=any(c.recipient_allowlist) and (i.lease_until is null or i.lease_until<now())
 and (i.first_attempt_at is null or i.first_attempt_at>now()-interval '23 hours') and i.attempts<5
 -- Preserve lifecycle ordering for each booking, including uncertain outcomes.
 and not exists(select 1 from vega_private.booking_email_intents older where older.tenant_id=i.tenant_id and older.business_id=i.business_id and older.participant_id=i.participant_id
 and (older.kind<>'class_reminder' or (i.kind='class_reminder' and older.reservation_id=i.reservation_id)) and (older.created_at,older.id)<(i.created_at,i.id) and older.status in ('intent_created','sending','uncertain','needs_review'))
 order by i.created_at,i.id for update of i skip locked limit 1)
 update vega_private.booking_email_intents i set status='sending',lease_token=lease,lease_until=now()+interval '120 seconds',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now())
 from candidate c where i.id=c.id returning i.id,i.message;
end $$;
create or replace function vega_private.finish_booking_email(intent_id text,lease uuid,outcome text,provider text,why text) returns void
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
 if outcome not in ('provider_accepted','uncertain','failed') or (outcome='provider_accepted' and provider is null) then raise exception 'Invalid delivery evidence'; end if;
 update vega_private.booking_email_intents set status=case when kind='class_reminder' and outcome='uncertain' then 'needs_review' else outcome end,provider_id=provider,reason=why,
 accepted_at=case when outcome='provider_accepted' then now() else accepted_at end,
 available_at=now()+interval '60 seconds',lease_token=null,lease_until=null
 where id=intent_id and lease_token=lease and status='sending';
end $$;


revoke acrux_booking_email from postgres granted by postgres;
do $$ begin if pg_has_role('postgres','acrux_booking_email','USAGE') or pg_has_role('postgres','acrux_booking_email','SET') then raise exception 'Temporary elevation remains'; end if; end $$;
commit;
