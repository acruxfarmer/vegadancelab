begin;
alter table vega_private.studio_publications add column onboarding_enabled boolean not null default false;
create role acrux_member_onboarding nologin nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema vega_private to acrux_member_onboarding;
grant select on vega_private.studio_publications to acrux_member_onboarding;
grant select,update on vega_private.app_state to acrux_member_onboarding;
grant select,insert on vega_private.app_members to acrux_member_onboarding;
create policy onboarding_publication on vega_private.studio_publications for select to acrux_member_onboarding using(published and onboarding_enabled);
create policy onboarding_state on vega_private.app_state to acrux_member_onboarding
 using(exists(select 1 from vega_private.studio_publications p where p.tenant_id=app_state.tenant_id and p.business_id=app_state.business_id))
 with check(exists(select 1 from vega_private.studio_publications p where p.tenant_id=app_state.tenant_id and p.business_id=app_state.business_id));
create policy onboarding_members_read on vega_private.app_members for select to acrux_member_onboarding
 using(exists(select 1 from vega_private.studio_publications p where p.tenant_id=app_members.tenant_id and p.business_id=app_members.business_id));
create policy onboarding_member_insert on vega_private.app_members for insert to acrux_member_onboarding
 with check(role='member' and cardinality(participant_ids)=1 and user_id::text=current_setting('vega.actor_id',true)
 and exists(select 1 from vega_private.studio_publications p where p.tenant_id=app_members.tenant_id and p.business_id=app_members.business_id));

-- Called only with a server-verified session actor, transaction-local. The
-- provider-confirmed email is supplied only by the verified server route, never user_metadata.
create function vega_private.onboard_public_member(studio_slug text,display_name text,verified_email text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,vega_private as $$
declare p record; a record; m record; actor uuid; email_address text; participant text;
 before_state jsonb; after_state jsonb; profile jsonb; result jsonb; link_count integer;
begin
 actor:=nullif(current_setting('vega.actor_id',true),'')::uuid;
 if actor is null then raise exception 'Verified account required'; end if;
 email_address:=lower(trim(verified_email));
 if email_address is null or email_address='' or length(email_address)>254 then return jsonb_build_object('status','verification_required'); end if;
 select * into p from vega_private.studio_publications where slug=studio_slug and published and onboarding_enabled;
 if not found then return jsonb_build_object('status','unavailable'); end if;
 select * into a from vega_private.app_state where tenant_id=p.tenant_id and business_id=p.business_id for update;
 before_state:=a.state;
 select * into m from vega_private.app_members where user_id=actor and tenant_id=p.tenant_id and business_id=p.business_id;
 if found then
  if m.role='staff' then return jsonb_build_object('status','existing_staff','tenantId',p.tenant_id,'businessId',p.business_id); end if;
  if cardinality(m.participant_ids)<>1 then return jsonb_build_object('status','needs_staff_review'); end if;
  participant:=m.participant_ids[1];
  select count(*) into link_count from jsonb_array_elements(coalesce(a.state->'participants','[]')) r where r->>'id'=participant
   and (not r ? 'tenantId' or r->>'tenantId'=p.tenant_id) and (not r ? 'businessId' or r->>'businessId'=p.business_id);
  if link_count<>1 or exists(select 1 from jsonb_array_elements(coalesce(a.state->'customerProfiles','[]')) r
   where r->>'tenantId'=p.tenant_id and r->>'businessId'=p.business_id and (r->>'accountId'=actor::text or r->>'participantId'=participant)
   and (r->>'accountId' is distinct from actor::text or r->>'participantId' is distinct from participant))
   or (select count(*) from jsonb_array_elements(coalesce(a.state->'customerProfiles','[]')) r where r->>'accountId'=actor::text and r->>'tenantId'=p.tenant_id and r->>'businessId'=p.business_id)>1
   then return jsonb_build_object('status','needs_staff_review'); end if;
  return jsonb_build_object('status','ready','tenantId',p.tenant_id,'businessId',p.business_id,'participantId',participant,'created',false);
 end if;
 if display_name is null or length(trim(display_name))<1 or length(display_name)>120 or display_name ~ '[[:cntrl:]]' then return jsonb_build_object('status','name_required'); end if;
 -- A possible existing relationship is a review case, never an automatic claim.
 if exists(select 1 from jsonb_array_elements(coalesce(a.state->'customerProfiles','[]')) r
   where r->>'accountId'=actor::text or lower(trim(r->'fields'->>'contactEmail'))=email_address)
 or exists(select 1 from jsonb_array_elements(coalesce(a.state->'participants','[]')) r
   where r->>'accountId'=actor::text or lower(trim(r->>'email'))=email_address or lower(trim(r->>'name'))=lower(trim(display_name)))
 or exists(select 1 from jsonb_array_elements(coalesce(a.state->'waiverAcceptances','[]')) r where r->>'accountId'=actor::text)
 then return jsonb_build_object('status','needs_staff_review'); end if;
 participant:=gen_random_uuid()::text;
 profile:=jsonb_build_object('tenantId',p.tenant_id,'businessId',p.business_id,'accountId',actor,'participantId',participant,
  'fields',jsonb_build_object('displayName',trim(display_name),'contactEmail',email_address,'phone',''),'revision',1,'updatedAt',now());
 after_state:=jsonb_set(a.state,'{participants}',coalesce(a.state->'participants','[]')||jsonb_build_array(jsonb_build_object('id',participant,'name',trim(display_name),'relationship','Self','tenantId',p.tenant_id,'businessId',p.business_id)));
 after_state:=jsonb_set(after_state,'{customerProfiles}',coalesce(a.state->'customerProfiles','[]')||jsonb_build_array(profile));
 after_state:=jsonb_set(after_state,'{activity}',coalesce(a.state->'activity','[]')||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'action','member-onboarding','actorId',actor,'subjectId',participant,'tenantId',p.tenant_id,'businessId',p.business_id,'createdAt',now())));
 insert into vega_private.app_members(user_id,tenant_id,business_id,role,participant_ids) values(actor,p.tenant_id,p.business_id,'member',array[participant]);
 update vega_private.app_state set state=after_state,revision=revision+1,updated_at=now() where tenant_id=p.tenant_id and business_id=p.business_id;
 result:=jsonb_build_object('status','ready','tenantId',p.tenant_id,'businessId',p.business_id,'participantId',participant,'created',true);
 -- Internal source snapshots are consumed by the existing encrypted recovery
 -- receipt writer in the same transaction; they never enter the HTTP response.
 return result||jsonb_build_object('_before',before_state,'_after',after_state,'_revision',a.revision);
end $$;
grant acrux_member_onboarding to postgres;
grant create on schema vega_private to acrux_member_onboarding;
alter function vega_private.onboard_public_member(text,text,text) owner to acrux_member_onboarding;
revoke create on schema vega_private from acrux_member_onboarding;
revoke all on function vega_private.onboard_public_member(text,text,text) from public,anon,authenticated;
grant execute on function vega_private.onboard_public_member(text,text,text) to vega_app_runtime;
revoke acrux_member_onboarding from postgres;
commit;
