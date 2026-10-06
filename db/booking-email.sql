-- Development booking lifecycle outbox. No booking, payment or receipt rules change.
begin;
create role acrux_booking_email nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema vega_private to acrux_booking_email;
grant select on vega_private.app_members,vega_private.app_state,vega_private.studio_publications to acrux_booking_email;
create policy booking_email_members on vega_private.app_members for select to acrux_booking_email using(true);
create policy booking_email_source on vega_private.app_state for select to acrux_booking_email using(true);
create policy booking_email_studio on vega_private.studio_publications for select to acrux_booking_email using(true);

create table vega_private.booking_email_configuration(
 tenant_id text not null,business_id text not null,
 sender text not null,origin text not null check(origin='https://vega-development-web.onrender.com'),
 enabled boolean not null default false,recipient_allowlist text[] not null default '{}',
 primary key(tenant_id,business_id),foreign key(tenant_id,business_id) references vega_private.app_state
);
create table vega_private.booking_email_intents(
 id text primary key,tenant_id text not null,business_id text not null,
 reservation_id text not null,participant_id text not null,
 kind text not null check(kind in ('booking_confirmation','booking_cancellation','rebooking_confirmation','waitlist_promotion')),
 snapshot jsonb not null,configuration jsonb not null,recipient text,account_id uuid,
 message jsonb,status text not null default 'intent_created' check(status in ('intent_created','sending','uncertain','provider_accepted','delivered','failed','needs_review')),
 reason text,provider_id text,attempts integer not null default 0,
 created_at timestamptz not null default now(),first_attempt_at timestamptz,available_at timestamptz not null default now(),
 lease_token uuid,lease_until timestamptz,accepted_at timestamptz,delivered_at timestamptz,delivery_evidence text,
 unique(tenant_id,business_id,reservation_id,kind),foreign key(tenant_id,business_id) references vega_private.app_state,
 check(status<>'delivered' or (provider_id is not null and delivered_at is not null and delivery_evidence is not null))
);
alter table vega_private.booking_email_configuration enable row level security;
alter table vega_private.booking_email_configuration force row level security;
alter table vega_private.booking_email_intents enable row level security;
alter table vega_private.booking_email_intents force row level security;
revoke all on vega_private.booking_email_configuration,vega_private.booking_email_intents from public,anon,authenticated,vega_app_runtime;
grant select on vega_private.booking_email_configuration to acrux_booking_email;
grant select,insert,update on vega_private.booking_email_intents to acrux_booking_email;
create policy booking_email_config on vega_private.booking_email_configuration for select to acrux_booking_email using(true);
create policy booking_email_delivery on vega_private.booking_email_intents to acrux_booking_email using(true) with check(true);
grant select(id,tenant_id,business_id,reservation_id,participant_id,kind,status,created_at) on vega_private.booking_email_intents to vega_app_runtime;
create policy booking_email_projection on vega_private.booking_email_intents for select to vega_app_runtime using(
 exists(select 1 from vega_private.app_members m where m.tenant_id=booking_email_intents.tenant_id and m.business_id=booking_email_intents.business_id
 and (m.role='staff' or booking_email_intents.participant_id=any(m.participant_ids))));

-- Internal helper, never executable by clients or the application role. A single
-- self relationship plus authoritative confirmed Auth address is required.
-- This single private lookup retains the migration owner's Auth read capability;
-- the email owner receives EXECUTE only, never general Auth table access.
create function vega_private.booking_email_recipient(t text,b text,p text) returns table(account_id uuid,email text)
language sql stable security definer set search_path=pg_catalog,vega_private as $$
 select u.id,lower(trim(u.email)) from vega_private.app_members m join auth.users u on u.id=m.user_id
 join vega_private.app_state s on s.tenant_id=m.tenant_id and s.business_id=m.business_id
 where m.tenant_id=t and m.business_id=b and m.role='member' and m.participant_ids=array[p]
 and u.email_confirmed_at is not null and u.is_anonymous is not true and u.deleted_at is null and (u.banned_until is null or u.banned_until<now())
 and u.email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$' and length(u.email)<=254
 and (select count(*) from vega_private.app_members n where n.tenant_id=t and n.business_id=b and p=any(n.participant_ids))=1
 and (select count(*) from jsonb_array_elements(coalesce(s.state->'customerProfiles','[]')) x
 where x->>'tenantId'=t and x->>'businessId'=b and (x->>'participantId'=p or x->>'accountId'=u.id::text))=1
 and exists(select 1 from jsonb_array_elements(coalesce(s.state->'customerProfiles','[]')) x where x->>'tenantId'=t and x->>'businessId'=b and x->>'participantId'=p and x->>'accountId'=u.id::text);
$$;

create function vega_private.enqueue_booking_email(t text,b text,intent jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
declare recipient record; config jsonb; actor uuid;
begin
 actor:=nullif(current_setting('vega.actor_id',true),'')::uuid;
 if actor is null or not exists(select 1 from vega_private.app_members where user_id=actor and tenant_id=t and business_id=b and (role='staff' or intent->>'participantId'=any(participant_ids))) then raise exception 'Business access required'; end if;
 select * into recipient from vega_private.booking_email_recipient(t,b,intent->>'participantId');
 select jsonb_build_object('name',p.name,'timeZone',p.time_zone,'slug',p.slug,'tenantId',t,'businessId',b,'sender',c.sender,'origin',c.origin) into config
 from vega_private.studio_publications p join vega_private.booking_email_configuration c using(tenant_id,business_id) where p.tenant_id=t and p.business_id=b;
 insert into vega_private.booking_email_intents(id,tenant_id,business_id,reservation_id,participant_id,kind,snapshot,configuration,recipient,account_id,status,reason)
 values(intent->>'id',t,b,intent->>'reservationId',intent->>'participantId',intent->>'kind',intent->'snapshot',coalesce(config,'{}'),recipient.email,recipient.account_id,
 case when recipient.email is null or config is null then 'needs_review' else 'intent_created' end,
 case when recipient.email is null then 'verified_self_recipient_required' when config is null then 'business_sender_required' end)
 on conflict(tenant_id,business_id,reservation_id,kind) do nothing;
end $$;

create function vega_private.pending_booking_email_messages() returns table(id text,kind text,snapshot jsonb,configuration jsonb,recipient text)
language sql security definer set search_path=pg_catalog,vega_private as $$
 select i.id,i.kind,i.snapshot,i.configuration,i.recipient from vega_private.booking_email_intents i
 join vega_private.booking_email_configuration c using(tenant_id,business_id)
 where i.status='intent_created' and i.message is null and c.enabled and i.recipient=any(c.recipient_allowlist) order by i.created_at limit 25;
$$;
create function vega_private.prepare_booking_email(intent_id text,body jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
 if body is not null and not exists(select 1 from vega_private.booking_email_intents i where i.id=intent_id and body->'to'=jsonb_build_array(i.recipient)
 and jsonb_typeof(body->'text')='string' and jsonb_typeof(body->'subject')='string'
 and body->>'from' like ('%<'||(i.configuration->>'sender')||'>')
 and body-array['from','to','subject','text']='{}'::jsonb) then raise exception 'Message recipient or sender mismatch'; end if;
 update vega_private.booking_email_intents set message=body,status=case when body is null then 'needs_review' else status end,
 reason=case when body is null then 'content_requires_review' else reason end
 where id=intent_id and status='intent_created' and message is null and first_attempt_at is null;
end
$$;
create function vega_private.claim_booking_email(lease uuid) returns table(id text,message jsonb)
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
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
 and (older.created_at,older.id)<(i.created_at,i.id) and older.status in ('intent_created','sending','uncertain','needs_review'))
 order by i.created_at,i.id for update of i skip locked limit 1)
 update vega_private.booking_email_intents i set status='sending',lease_token=lease,lease_until=now()+interval '120 seconds',attempts=attempts+1,first_attempt_at=coalesce(first_attempt_at,now())
 from candidate c where i.id=c.id returning i.id,i.message;
end $$;
create function vega_private.finish_booking_email(intent_id text,lease uuid,outcome text,provider text,why text) returns void
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
begin
 if outcome not in ('provider_accepted','uncertain','failed') or (outcome='provider_accepted' and provider is null) then raise exception 'Invalid delivery evidence'; end if;
 update vega_private.booking_email_intents set status=outcome,provider_id=provider,reason=why,
 accepted_at=case when outcome='provider_accepted' then now() else accepted_at end,
 available_at=now()+interval '60 seconds',lease_token=null,lease_until=null
 where id=intent_id and lease_token=lease and status='sending';
end $$;

-- Restricted owner can read linkage but cannot modify any booking/member record.
grant acrux_booking_email to postgres with inherit true;
grant acrux_booking_email to postgres with set true;
grant create on schema vega_private to acrux_booking_email;
alter function vega_private.enqueue_booking_email(text,text,jsonb) owner to acrux_booking_email;
alter function vega_private.pending_booking_email_messages() owner to acrux_booking_email;
alter function vega_private.prepare_booking_email(text,jsonb) owner to acrux_booking_email;
alter function vega_private.claim_booking_email(uuid) owner to acrux_booking_email;
alter function vega_private.finish_booking_email(text,uuid,text,text,text) owner to acrux_booking_email;
revoke create on schema vega_private from acrux_booking_email;
revoke all on function vega_private.booking_email_recipient(text,text,text),vega_private.enqueue_booking_email(text,text,jsonb),vega_private.pending_booking_email_messages(),vega_private.prepare_booking_email(text,jsonb),vega_private.claim_booking_email(uuid),vega_private.finish_booking_email(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function vega_private.booking_email_recipient(text,text,text) to acrux_booking_email;
grant execute on function vega_private.enqueue_booking_email(text,text,jsonb),vega_private.pending_booking_email_messages(),vega_private.prepare_booking_email(text,jsonb),vega_private.claim_booking_email(uuid),vega_private.finish_booking_email(text,uuid,text,text,text) to vega_app_runtime;
revoke acrux_booking_email from postgres granted by postgres;
do $$ begin if pg_has_role('postgres','acrux_booking_email','USAGE') or pg_has_role('postgres','acrux_booking_email','SET') then raise exception 'Temporary elevation not removed'; end if; end $$;
commit;
