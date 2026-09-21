-- Password activation occurs locally through the operator-only handoff.
create role vega_ingest_runtime nologin inherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls connection limit 5;
grant vega_webhook_ingest to vega_ingest_runtime with inherit true, set false;
grant vega_ingest_runtime to postgres with inherit false;
alter role vega_ingest_runtime set statement_timeout = '10s';
alter role vega_ingest_runtime set lock_timeout = '5s';
alter role vega_ingest_runtime set idle_in_transaction_session_timeout = '15s';
