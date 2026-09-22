# Section 4.3 — Edge Cases & Hardening

Status: local verification complete; Development Preview verification pending pinned backend rollout. Sections 1–3 and 4.1–4.2 remain closed.

## Acceptance comparison and reused evidence

| Requirement | Existing evidence preserved | Focused addition |
|---|---|---|
| Duplicate bookings, cancellations, credit issuance and corrections | application-adversarial, cancellation, cancellation-transaction, entitlements tests; hosted Sections 3.1/3.2/4.1 records | Real PostgreSQL overlapping requests and durable-receipt replay |
| Limited capacity and ledger atomicity | Shared aggregate transaction with FOR UPDATE; hosted stale-last-seat rejection | Two connections demonstrably waiting on the same database row; one winner, one rejection, one consumption |
| Stale/revoked identity and scope | application-api/session tests; hosted member isolation | Recheck assignment after lock wait, bind browser request token to session generation, strict authenticated UUID validation |
| Invalid requests and ineligible credits | Existing domain validation and entitlement/cancellation tests | Malformed JSON/media/oversize/path tests; malformed persisted validity windows, restrictions, class date and capacity fail closed |
| Invalid final-state corrections and spent restorations | cancellation.test and hosted-staff-booking-verified.md | Reused; concurrent correction tests assert exact reversal/restoration event counts |
| Staff business scope and member authority | application-schema.sql RLS and previous smoke test | Real restricted-role cross-business reads/updates denied; unauthorized commands leave state/audit unchanged |
| Partial failure and retry | State and command receipt share one transaction | Actual receipt-insert failure after state update rolls back state, credits and audit; lost commit acknowledgement replay makes no second mutation |
| Refresh/reload recovery | Session generation and account reload already verified | Opaque per-account request identity retained in sessionStorage; no form values, notes or authority stored; unavailable storage blocks mutation |
| Dependency failures and readiness | Existing generic 503 responses and separate liveness | Auth/database outage and recovery checks; readiness verifies receipt grants, restricted role and forced RLS; Development Render probe must use /health/application |
| Audit preservation | Existing immutable originals and correction history; Section 4.2 audit projection | Failed transactions/rejections preserve prior records; no parallel error ledger added |

Prior hosted evidence is in workspace `vega/docs/hosted-{member-booking,member-cancellation,member-portal,staff-booking,reporting-audit}-verified.md`, plus cancellation/issuance closure evidence. Those workflows were not reimplemented.

## Concrete gaps corrected

- Date comparisons against NaN allowed malformed persisted entitlement windows and class dates to pass some checks. Invalid windows/restrictions/capacities now fail closed; legitimate legacy unrestricted credits remain supported.
- In-memory request IDs disappeared on reload after an uncertain response. The browser now retains a SHA-256 intent key and request UUID, scoped to tenant/business/actor, until the operation and account refresh succeed. Identical retry uses the existing server receipt. Closing the tab/clearing site storage ends this recovery scope; check account/audit state before manually recreating an uncertain grant elsewhere.
- A queued command could retain a staff role read before waiting for the business lock. It now rejects if the assignment changed during that wait. Browser retries also cannot switch to a replacement session's token.
- Readiness checked state privileges but not receipt permissions or runtime RLS posture. It now rejects missing command grants, role elevation, table ownership and missing forced RLS. The existing liveness endpoint remains separate.

No new database tables, subsystem, booking rules or cancellation accounting implementation.

## Verification

- `node --test test/*.test.mjs`: 91 passed, including malformed requests, dependency outages, session isolation, new date guards and reload-safe request identity.
- `node scripts/verify-hardening-postgres.mjs`: 11 real PostgreSQL checks, using an isolated native PostgreSQL 18.4 process on loopback, exact application schema and restricted runtime login. Concurrent checks first hold the aggregate lock and assert every contender is actually waiting in pg_stat_activity before release. All checks pass. Cluster is stopped in finally; no hosted data or credentials used.
- Test binary source: official npm `embedded-postgres@18.4.0-beta.17` / `@embedded-postgres/windows-x64`, isolated in workspace `vega-hardening-tools`; no runtime dependency change. Set PG_TEST_BIN to its native/bin directory, optional PG_TEST_PORT (49152–65535). Harness always initializes a fresh synthetic cluster and never accepts a hosted URL.
- Browser: real staff courtesy form against loopback fixture. First command committed one credit then returned a synthetic 503. UI explained uncertainty/retry; reload showed one credit; same form retry returned original receipt and remained one credit. Server recorded one COMMIT and one REPLAY; no browser warnings/errors. Fixture stopped and tab closed.
- Front-door asset build and git diff whitespace check pass.

## Development rollout and remaining verification

Pinned Development web deployment only. Change that service's healthCheckPath from /health/live to /health/application after verifying its current readiness and identity; no other service settings. Readiness must return 200 after rollout, and configured Render path must be recorded. This follows Render's documented application-level health checks: https://render.com/docs/health-checks . No disruptive hosted outage, permission revocation or synthetic failure injection.

Preview verification: new request-journal asset loads; signed-in staff account/report state reloads accurately; original historical records and credit balances remain unchanged; existing member staff-control isolation remains supported by closed evidence and local regression suite. Authenticated hosted checks require the user's signed-in Preview. Do not close this slice until rollout and hosted checks are recorded.

Production, Square disabled, worker and unrelated services remain unchanged. Temporary health instrumentation remains. Future bounded Square requirement: when payment integration is explicitly enabled, verify provider timeout/duplicate webhook/payment-versus-entitlement recovery using supported sandbox workflows; not part of this slice.
