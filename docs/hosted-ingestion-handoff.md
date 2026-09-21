# Hosted development ingestion handoff

B2 is complete; no B2 calls or changes are part of this handoff. Square's subscription stays disabled.

The private sandbox inbox exists. Migration `vega_ingestion_runtime_login_role` created `vega_ingest_runtime` as NOLOGIN with only inherited inbox insert/select permissions. Actual role checks confirmed no update/delete/truncate access. Security advisor reported no findings.

The runtime adapter requires verified TLS and the exact development project/login, verifies forced RLS and restricted privileges, and commits each event before acknowledgment. `/health/ingestion` checks this path; `/health/ready` continues to report overall application setup pending.

Run `scripts/handoff-hosted-ingestion.ps1` in the already-unlocked Bitwarden terminal. It reads the exact Dev Stack operator/runtime records; if absent, stores a generated dedicated `DATABASE_URL` in `Vega Dev - Supabase` before activating the login. It never resets an existing login. Operator credentials stay outside runtime. An interrupted handoff is retryable using the same stored URL.

Required operator access: existing `Vega Dev - Supabase Operator / ADMIN_DATABASE_URL` and `Vega Dev - Render Operator / RENDER_API_KEY`. If the Render field is missing, create a personal API key in Render Account Settings → API Keys and store it as a hidden custom field in that exact existing operator item. Do not put it in `.env.local` or paste it into chat. No new API key is needed if a valid one is already stored.

The handoff verifies the exact Render development web-service identity, sends only six ingestion environment variables, sets the dependency-install/test build command, and deploys the local commit only when it matches remote main. It does not touch the worker, B2, Square subscription, or unrelated provider credentials.

After deployment, the hosted checker submits only signed synthetic sandbox events. Required evidence: ingestion readiness 200, invalid signature 401, first delivery stored 200, duplicate 200, conflict 409, followed by an independent database query confirming exactly one matching durable row. Do not enable Square based only on an HTTP response.

Remaining full-application work includes the Vercel front door, worker processing, and application workflows. Ingestion readiness is not full-application readiness.
