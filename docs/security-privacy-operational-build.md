# Vega operational build — security and privacy record

2026-09-21 · Buttons, canonical skill `7367904f1a11c6de9c4a35e817d403393f4250ba`.

Scope: development application boundaries and source review during the authorized operational build. This is not Production clearance or a new approval gate. Foundation verification remains settled; no secret values or new provider probes are required by this review.

## Required properties

The server verifies the tenant-native Supabase authentication subject before resolving explicit tenant/business membership and participant authority. Editable user metadata, browser role selectors, submitted owner identifiers and payment relationships are not authority. Unassigned authenticated users receive no operational data. Public schedules expose only a deliberate public projection.

The planned application connection uses restricted `vega_app_runtime` capabilities and transaction-local actor context. Authority/membership/delegation tables must not be writable by ordinary runtime CRUD grants. Actor context must originate from verified authentication, use transaction-local state and not survive pooled-connection reuse. Application commands must enforce both resource scope and permitted transitions; RLS alone does not prevent a permitted row updater changing an impermissible field.

The ingestion identity remains append-only. Separate worker credentials select accepted inbox records and mutate only worker-owned processing state and permitted observations. The application cannot fabricate financial observations. Operator credentials, provider tokens and database connections remain outside browser assets and responses. No service-role/postgres fallback is an acceptable solution to missing application grants.

## Initial frontend source assessment

Inspected `public/app.js` as an in-progress candidate. Session token is held in memory; synthetic demo data is explicitly labeled and its mutations remain in the tab. Dynamic server text is escaped before HTML insertion. These observations do not establish backend isolation or a tested deployed session flow.

Specific implementation feedback supplied to Ray: normalize an initial staff hash route for members as well as later hash changes; clear session and local form state on account exit; retain operation idempotency identity during ambiguous retries. CSV exports should neutralize formula prefixes including leading control/whitespace characters. Source changes and corresponding evidence remain to be assessed when the candidate is ready.

## Candidate-specific checks

- Missing, expired and forged authentication is denied; an authenticated but unassigned user cannot access workspace data.
- A member cannot enumerate another participant/reservation, staff-only operational records or jobs, even through direct API requests.
- A member cannot mark attendance, write role assignments, change financial observations, or infer authority from payer status.
- Cross-scope participant/class requests are denied; pooled actor changes do not leak the previous principal context.
- Concurrent last-seat reservations produce one accepted allocation; replay is stable; changed-content replay conflicts; cancellation releases capacity once.
- Ingestion cannot mutate application records; application cannot mutate inbox, membership authority or financial records; worker cannot update/delete inbox evidence.
- Error responses and logs exclude credentials, raw SQL and unnecessary customer records; authenticated responses are uncached.

These checks are proof inputs for the builder/test lane, not assertions of passage. Current disposition: authorized implementation continues; no new human decision is needed. Review coverage is limited to the stated plan, architecture addendum and initial frontend source until backend and candidate tests are available.

## Initial application source follow-up

Inspected `db/application-schema.sql`, `src/runtime/application-database.mjs` and `src/application.mjs` during implementation. Membership grants are SELECT-only; transaction-local actor context precedes membership lookup; a Business state row lock encloses transition and idempotency receipt commit. These are source observations, not executed database proof.

The chosen aggregate state design means database RLS isolates Businesses, while the application server enforces participant visibility and command authority inside each Business. It must not be described as database-enforced participant row isolation. `app_commands` receives SELECT/INSERT only and retains immutable command receipts; `state.activity` is part of mutable JSON and is not an independently append-only audit log.

Finding supplied to Astra: the initial `visibleState` included draft notifications for their target participant, exposing staff-authored unsent messages. Required correction is an explicit customer visibility condition or omission until a delivery/publishing model exists. A second recommendation is explicit output keys/projections rather than cloning arbitrary state keys into member responses. Both findings remain pending candidate correction verification.

Correction verified during Test Smoke follow-up: `visibleState` now uses explicit collection keys and requires `status === 'published'` for member-visible notifications. Independent execution of the relevant regression test passed. These two source findings are resolved for the examined development candidate.

Inspected `src/runtime/application-api.mjs`: protected API paths validate bearer credentials using the fixed development Supabase `/auth/v1/user` endpoint before the store receives the subject. Request bodies are size-limited, commands are allowlisted, unexpected errors are generic and API responses are `no-store`. Sign-in transiently processes credentials at Render before forwarding to Supabase; inspected code does not store/log them. The frontend holds the returned access token in memory. Token expiry requires another sign-in in this initial flow. No server authority bypass was identified in this inspected version; dynamic denial/isolated-data evidence is still required.

Subsequent executed evidence is recorded in `test-smoke-operational-build.md`: restricted app and worker SQL grant/RLS exercises passed on the development database with rollback; local HTTP serving/security headers and fail-closed unconfigured routes passed. This resolves the initial database-policy execution gap for the exercised scope, but does not establish authenticated hosted end-to-end isolation or runtime credential availability.

The staff processing visibility addition gives app runtime scoped inbox/journal SELECT through operator-owned merchant/environment bindings and staff membership. Executed RLS tests confirm member, unknown merchant and cross-Business denial, plus binding/journal mutation denial. API code returns only bounded event metadata, not raw payload. Matching raw rows are readable by the scoped server role, so API projection remains the payload disclosure boundary; no financial observation write capability was introduced. Detailed source/evidence limits remain in the Test Smoke record.
