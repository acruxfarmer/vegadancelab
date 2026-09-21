begin;
grant vega_worker_runtime to postgres with inherit false, set true;
insert into vega_private.square_webhook_inbox(event_id,event_type,merchant_id,body_sha256,payload)
values('smoke-worker-2109','payment.updated','synthetic-merchant',repeat('0',64),'{"event_id":"smoke-worker-2109","type":"payment.updated","merchant_id":"synthetic-merchant"}');
set local role vega_worker_runtime;
do $$ declare n integer; begin
select count(*) into n from vega_private.square_webhook_inbox where event_id='smoke-worker-2109'; if n<>1 then raise exception 'INBOX_READ_FAILED'; end if;
begin update vega_private.square_webhook_inbox set merchant_id='changed'; raise exception 'INBOX_UPDATE_ALLOWED'; exception when insufficient_privilege then null; end;
begin delete from vega_private.square_webhook_inbox; raise exception 'INBOX_DELETE_ALLOWED'; exception when insufficient_privilege then null; end;
begin select count(*) into n from vega_private.app_members; raise exception 'APP_READ_ALLOWED'; exception when insufficient_privilege then null; end;
insert into vega_private.square_financial_observations(event_id,environment,merchant_id,resource_kind,resource_id,observation) values('smoke-worker-2109','sandbox','synthetic-merchant','payment','synthetic-payment','{"synthetic":true}');
insert into vega_private.square_processing_journal(event_id,status) values('smoke-worker-2109','processed');
begin insert into vega_private.square_processing_journal(event_id,status) values('smoke-worker-2109','processed'); raise exception 'DUPLICATE_RECEIPT_ALLOWED'; exception when unique_violation then null; end;
begin update vega_private.square_financial_observations set observation='{}'; raise exception 'OBSERVATION_UPDATE_ALLOWED'; exception when insufficient_privilege then null; end;
begin delete from vega_private.square_processing_journal; raise exception 'RECEIPT_DELETE_ALLOWED'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: worker inbox isolation, append-only observations/receipts and duplicate receipt rejection; rollback follows' as result;
rollback;
