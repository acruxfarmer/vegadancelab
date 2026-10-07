-- Development only. Narrow server playback bridge over existing private assets.
-- No new tables, roles, assets, ownership, entitlement or business-state writes.
begin;
create function media_private.viewer_material(placement uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p media_private.placements; r media_private.resources; source_state jsonb; video jsonb;
begin
 select * into p from media_private.placements where id=placement for share;
 if not found then return null; end if;
 -- Non-public placement existence/policy is not disclosed to unrelated callers.
 if not (p.document->>'authorized'='true' and p.document->>'visible'='true' and p.document->'policy'='{"kind":"public"}'::jsonb)
  and not exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=p.tenant_id and m.business_id=p.business_id)
  and not exists(select 1 from media_private.resources o where o.id=p.resource_id and o.owner_user_id::text=current_setting('vega.actor_id',true)) then return null; end if;
 if p.document->>'authorized'<>'true' or p.document->>'visible'<>'true' then return jsonb_build_object('placement',p.document); end if;
 select * into r from media_private.resources where id=p.resource_id for share;
 if not found or r.document->>'lifecycle'<>'active' or r.document->'source'->>'kind'<>'legacy_video'
  or r.document->'source'->>'provider'<>'business-media' then return jsonb_build_object('placement',p.document); end if;
 -- Exact canonical compatibility link; caller cannot choose an asset or business.
 if not exists(select 1 from media_private.legacy_media_links l where l.resource_id=r.id and l.tenant_id=r.owner_tenant_id
  and l.business_id=r.owner_business_id and l.video_id=r.document->'source'->>'reference') then return jsonb_build_object('placement',p.document); end if;
 select state into source_state from vega_private.app_state where tenant_id=r.owner_tenant_id and business_id=r.owner_business_id for share;
 select v into video from jsonb_array_elements(coalesce(source_state->'videos','[]')) v
  where v->>'id'=r.document->'source'->>'reference' and v->>'tenantId'=r.owner_tenant_id and v->>'businessId'=r.owner_business_id and v->>'publishState'='published';
 return jsonb_build_object('placement',p.document,'video',video);
end;
$$;
-- Existing authenticated legacy route uses this to prevent omitting placement
-- parameters from bypassing a placement in the source business context.
create function media_private.legacy_viewer_placement(tenant text,business text,video text) returns uuid
language sql stable security definer set search_path='' as $$
 select p.id from media_private.legacy_media_links l join media_private.placements p
 on p.resource_id=l.resource_id and p.tenant_id=l.tenant_id and p.business_id=l.business_id
 where l.tenant_id=tenant and l.business_id=business and l.video_id=video
 and exists(select 1 from vega_private.app_members m where m.user_id::text=current_setting('vega.actor_id',true) and m.tenant_id=tenant and m.business_id=business);
$$;
revoke all on function media_private.viewer_material(uuid),media_private.legacy_viewer_placement(text,text,text) from public,anon,authenticated;
grant execute on function media_private.viewer_material(uuid),media_private.legacy_viewer_placement(text,text,text) to vega_app_runtime;
commit;
