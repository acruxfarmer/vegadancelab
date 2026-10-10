-- Development fixture only. Every synthetic write rolls back.
begin;
set local role vega_app_runtime;
select set_config('vega.actor_id','01d4a4c0-9758-4bf4-8561-56232b9c9e4a',true);
do $$
declare rid uuid:=gen_random_uuid(); bid uuid:=gen_random_uuid(); owner_id uuid:='01d4a4c0-9758-4bf4-8561-56232b9c9e4a'; d jsonb;
begin
 insert into media_private.resources(id,owner_user_id,submitted_by,document) values(rid,owner_id,owner_id,jsonb_build_object(
  'id',rid,'submittedBy',owner_id,'owner',jsonb_build_object('kind','user','userId',owner_id),'mediaType','video','lifecycle','active','revision',1,'title','Rental duration transaction proof','creator','Development','source',jsonb_build_object('kind','managed_reference','provider','acrux-managed','reference',gen_random_uuid()),'createdAt',now()));
 d:=jsonb_build_object('id',bid,'resourceId',rid,'provider','test-adapter','integrationRef','development','assetRef',null,'playbackRef',null,'state','pending','revision',1);
 insert into media_private.provider_bindings values(bid,rid,owner_id,'rental-transaction-test','fingerprint',d);
 update media_private.provider_bindings set document=document||'{"state":"uploading","revision":2}' where id=bid;
 update media_private.provider_bindings set document=document||'{"state":"processing","revision":3,"assetRef":"file-one"}' where id=bid;
 begin
  update media_private.provider_bindings set document=document||'{"state":"ready","revision":4,"playbackRef":"private","durationSeconds":120,"durationAssetRef":"wrong"}' where id=bid;
  raise exception 'FAIL: wrong-asset duration accepted';
 exception when insufficient_privilege then null; end;
 begin
  update media_private.provider_bindings set document=document||'{"state":"ready","revision":4,"playbackRef":"private","readyAt":"2099-01-01T00:00:00.000Z"}' where id=bid;
  raise exception 'FAIL: future readiness accepted';
 exception when insufficient_privilege then null; end;
 update media_private.provider_bindings set document=document||jsonb_build_object('state','ready','revision',4,'playbackRef','private','durationSeconds',120,'durationAssetRef','file-one','readyAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=bid;
 begin
  update media_private.provider_bindings set document=(document-'durationSeconds')||'{"state":"failed","revision":5}' where id=bid;
  raise exception 'FAIL: duration deletion accepted';
 exception when insufficient_privilege then null; end;
 begin
  update media_private.provider_bindings set document=(document-'readyAt')||'{"state":"failed","revision":5}' where id=bid;
  raise exception 'FAIL: readiness deletion accepted';
 exception when insufficient_privilege then null; end;
 begin
  update media_private.provider_bindings set document=document||'{"state":"failed","revision":5,"durationSeconds":121}' where id=bid;
  raise exception 'FAIL: duration edit accepted';
 exception when insufficient_privilege then null; end;
 perform set_config('vega.actor_id','e5946b40-9839-4a96-99d5-93262d9573f0',true);
 if exists(select 1 from media_private.provider_bindings where id=bid) then raise exception 'FAIL: foreign binding visible'; end if;
 perform set_config('vega.actor_id',owner_id::text,true);
 update media_private.provider_bindings set document=document||'{"state":"deleting","revision":5}' where id=bid;
 update media_private.provider_bindings set document=(document-array['durationSeconds','durationAssetRef','readyAt'])||'{"state":"deleted","revision":6,"assetRef":null,"playbackRef":null}' where id=bid;
end $$;
select 'VOD_RENTAL_BINDING_DATABASE_PASS' as result;
rollback;
