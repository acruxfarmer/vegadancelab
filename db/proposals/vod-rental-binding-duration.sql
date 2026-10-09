-- Development-only additive duration persistence. Existing untimed bindings remain valid.
begin;
create or replace function media_private.guard_provider_binding() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.actor_id::text is distinct from current_setting('vega.actor_id',true) or new.document->>'state'<>'pending' or new.document->>'revision'<>'1' then raise exception 'Invalid binding creation' using errcode='42501'; end if;
 else
  if (new.document - array['state','revision','assetRef','playbackRef','durationSeconds','durationAssetRef','readyAt']) is distinct from (old.document - array['state','revision','assetRef','playbackRef','durationSeconds','durationAssetRef','readyAt'])
   or (new.document->>'revision')::int<>(old.document->>'revision')::int+1 then raise exception 'Invalid binding update' using errcode='42501'; end if;
  if not (case old.document->>'state'
   when 'pending' then new.document->>'state' in ('uploading','failed','deleting')
   when 'uploading' then new.document->>'state' in ('processing','failed','deleting')
   when 'processing' then new.document->>'state' in ('ready','failed','deleting')
   when 'ready' then new.document->>'state' in ('failed','deleting')
   when 'failed' then new.document->>'state'='deleting'
   when 'deleting' then new.document->>'state'='deleted'
   else false end) then raise exception 'Invalid binding transition' using errcode='42501'; end if;
  if old.document->>'assetRef' is not null and new.document->>'state'<>'deleted' and new.document->>'assetRef' is distinct from old.document->>'assetRef' then raise exception 'Provider asset changed' using errcode='42501'; end if;
  if new.document->>'state'<>'deleted' and (new.document->'durationSeconds' is distinct from old.document->'durationSeconds' or new.document->'durationAssetRef' is distinct from old.document->'durationAssetRef' or new.document->'readyAt' is distinct from old.document->'readyAt') then
   if old.document->>'state'<>'processing' or new.document->>'state'<>'ready' or old.document ?| array['durationSeconds','durationAssetRef','readyAt'] then raise exception 'Readiness evidence is immutable' using errcode='42501'; end if;
  end if;
 end if;
 if tg_op='INSERT' and new.document ?| array['durationSeconds','durationAssetRef','readyAt'] then raise exception 'Premature readiness evidence' using errcode='42501'; end if;
 if new.document->>'state'='deleted' and new.document ?| array['durationSeconds','durationAssetRef','readyAt'] then raise exception 'Deleted binding retains readiness evidence' using errcode='42501'; end if;
 if new.document ? 'readyAt' and (jsonb_typeof(new.document->'readyAt') <> 'string' or (new.document->>'readyAt') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' or (new.document->>'readyAt')::timestamptz > clock_timestamp()+interval '1 minute') then raise exception 'Invalid readiness time' using errcode='42501'; end if;
 if new.document ? 'durationAssetRef' and not new.document ? 'durationSeconds' then raise exception 'Duration evidence incomplete' using errcode='42501'; end if;
 if new.document ? 'durationSeconds' then
  if jsonb_typeof(new.document->'durationSeconds') <> 'number' or (new.document->>'durationSeconds')::numeric <= 0 or (new.document->>'durationSeconds')::numeric > 86400 or new.document->>'durationAssetRef' is distinct from new.document->>'assetRef' then raise exception 'Invalid validated duration' using errcode='42501'; end if;
  if tg_op='UPDATE' and old.document ? 'durationSeconds' and (new.document->'durationSeconds' is distinct from old.document->'durationSeconds' or new.document->>'durationAssetRef' is distinct from old.document->>'durationAssetRef') then raise exception 'Duration revision cannot change' using errcode='42501'; end if;
 end if;
 return new;
end; $$;
commit;
