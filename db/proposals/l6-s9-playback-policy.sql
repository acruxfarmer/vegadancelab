-- Development only. Optional placement policy; no existing placement/resource rewrites.
begin;
create table media_private.playback_policies (
 placement_id uuid primary key references media_private.placements(id),
 policy jsonb not null default '{}'::jsonb,
 revision integer not null check(revision>0),
 history jsonb not null default '[]'::jsonb
);
alter table media_private.playback_policies enable row level security;
revoke all on media_private.playback_policies from public,anon,authenticated;
grant select,insert on media_private.playback_policies to vega_app_runtime;
grant update(policy,revision) on media_private.playback_policies to vega_app_runtime;
create policy playback_policy_manager on media_private.playback_policies to vega_app_runtime
 using(exists(select 1 from media_private.placements p join vega_private.app_members m using(tenant_id,business_id)
 where p.id=placement_id and m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff'))
 with check(exists(select 1 from media_private.placements p join vega_private.app_members m using(tenant_id,business_id)
 where p.id=placement_id and m.user_id::text=current_setting('vega.actor_id',true) and m.role='staff'));

create function media_private.guard_playback_policy() returns trigger
language plpgsql security invoker set search_path='' as $$
declare p media_private.placements; r media_private.resources; ref jsonb;
begin
 select * into p from media_private.placements where id=new.placement_id for share;
 if not found or p.document->>'authorized'<>'true' or not media_private.placement_resource_active(p.id)
  then raise exception 'Placement inactive' using errcode='42501'; end if;
 if tg_op='UPDATE' then
  if new.placement_id<>old.placement_id or new.revision<>old.revision+1 then raise exception 'Invalid policy revision'; end if;
 elsif new.revision<>1 then raise exception 'Invalid initial policy revision'; end if;
 if jsonb_typeof(new.policy)<>'object' or new.policy-array['preRoll','postRoll']<>'{}'::jsonb then raise exception 'Invalid playback policy'; end if;
 for ref in select value from jsonb_each(new.policy) loop
  if jsonb_typeof(ref)<>'object' or ref->>'kind' is distinct from 'media_resource'
   or ref-array['kind','resourceId']<>'{}'::jsonb or ref->>'resourceId' is null then raise exception 'Invalid media reference'; end if;
  select * into r from media_private.resources where id=(ref->>'resourceId')::uuid for share;
  if not found or r.document->>'lifecycle'<>'active' or r.document->'owner'->>'kind' is distinct from 'business'
   or r.owner_tenant_id is distinct from p.tenant_id or r.owner_business_id is distinct from p.business_id
   then raise exception 'Same business bumper ownership required' using errcode='42501'; end if;
 end loop;
 new.history=(case when tg_op='INSERT' then '[]'::jsonb else old.history end)||jsonb_build_array(jsonb_build_object('revision',new.revision,'policy',new.policy,'actorId',current_setting('vega.actor_id',true),'at',now()));
 return new;
end; $$;
revoke all on function media_private.guard_playback_policy() from public,anon,authenticated;
create trigger playback_policy_guard before insert or update on media_private.playback_policies for each row execute function media_private.guard_playback_policy();

-- Server-only projection, analogous to native_viewer_material. The application
-- must run L6-S2 before requesting it. Never granted to browser roles.
create function media_private.playback_policy_material(placement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p media_private.placements; r media_private.resources; b jsonb; v jsonb;
 pol jsonb; rev integer; sources jsonb='{}'::jsonb; ref jsonb;
begin
 select * into p from media_private.placements where id=placement for share;
 if not found or p.document->>'authorized'<>'true' or p.document->>'visible'<>'true' then return null; end if;
 select policy,revision into pol,rev from media_private.playback_policies where placement_id=p.id for share;
 pol=coalesce(pol,'{}'::jsonb);rev=coalesce(rev,0);
 for ref in select value from jsonb_each(pol) loop
  select * into r from media_private.resources where id=(ref->>'resourceId')::uuid for share;
  if not found or r.document->>'lifecycle'<>'active' or r.document->'owner'->>'kind' is distinct from 'business'
   or r.owner_tenant_id is distinct from p.tenant_id or r.owner_business_id is distinct from p.business_id then return null; end if;
  b=null;v=null;
  if r.document->'source'->>'kind'='managed_reference' then
   select document into b from media_private.provider_bindings where resource_id=r.id and document->>'state'<>'deleted' for share;
  elsif r.document->'source'->>'kind'='legacy_video' and r.document->'source'->>'provider'='business-media' then
   perform 1 from vega_private.app_state where tenant_id=p.tenant_id and business_id=p.business_id for share;
   select video into v from media_private.legacy_media_links l join vega_private.app_state s using(tenant_id,business_id),lateral jsonb_array_elements(s.state->'videos') video
    where l.resource_id=r.id and l.tenant_id=p.tenant_id and l.business_id=p.business_id
     and l.video_id=r.document->'source'->>'reference' and video->>'id'=l.video_id
     and video->>'tenantId'=p.tenant_id and video->>'businessId'=p.business_id and video->>'publishState'='published';
  end if;
  sources=sources||jsonb_build_object(r.id::text,jsonb_build_object('resource',r.document,'binding',b,'video',v));
 end loop;
 return jsonb_build_object('placement',p.document,'policy',pol,'revision',rev,'sources',sources);
end; $$;
revoke all on function media_private.playback_policy_material(uuid) from public,anon,authenticated;
grant execute on function media_private.playback_policy_material(uuid) to vega_app_runtime;
commit;
