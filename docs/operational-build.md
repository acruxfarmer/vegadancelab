# Vega operational application build — 21 September 2026

The settled development foundation is retained. This build adds a Vercel front door, Render application API and separate worker processing. Square stays disabled. No Production deployment, customer communication, purchase or provider replacement is included.

## Implemented

- Responsive member/staff wireframe with classes, reservations, rosters, waitlist promotion, attendance, participants, communication preferences and message drafts.
- Server authentication against the pinned Supabase project; identity assignments are operator-owned. The browser cannot grant itself a role or participant access.
- Business-scoped transactional application state with row locking, immutable idempotency receipts and separate participation/payment/attendance/notification outcomes. Participant-level permissions are enforced by the trusted application server; database RLS isolates Business membership.
- Separate worker identity, verified TLS, append-only intake, durable per-event processing receipts and financial observations. Crash recovery/replay cannot deliberately repeat an acknowledged event. No payment outcome changes a booking or attendance record.
- Staff processing visibility requires an explicit operator-owned sandbox merchant binding; unbound events remain unavailable to application users.
- Vercel static build uses only four public assets and rewrites API requests to the existing Render development service. Deployment requires the existing project's All Deployments authentication protection.

Passes/memberships, videos, events/tickets and merchandise have navigable synthetic wireframe surfaces. They are **not complete operational modules**: authenticated mode presents their unconfigured state rather than example purchases or entitlements. Outbound delivery and Square remain disabled.

## Database state

Applied to `cjdoczrxcjynjhgpgqop`: `vega_operational_application`, `vega_square_worker_processing`, `vega_application_processing_visibility`. `vega_app_runtime` and `vega_worker_runtime` are NOLOGIN pending protected credential activation. Existing ingest permissions and TLS remain unchanged. Security advisor returned no findings after these changes.

No real customer records or synthetic fixtures remain from database verification. There are no authentication users or application assignments yet. Initial application access requires a user-created development identity, followed by an explicit scoped staff assignment and empty Business state initialization. No identity is inferred from a browser role chooser, email resemblance or provider connection.

## Verification and limits

See [Test Smoke](test-smoke-operational-build.md), [security review](security-privacy-operational-build.md), [design](design.md) and [architecture](operational-application-architecture.md). Source/component, live database permission, local HTTP, visual and hosted evidence are separate. Real concurrent database commands and hosted authenticated journeys remain pending the runtime handoff.

## Authentication handoff

Bitwarden CLI status is locked. The existing Vercel CLI authentication returns HTTP 403 for the pinned development project. No credentials were printed or reset. The Vercel connector deployment action is unavailable; the reviewed direct API script uses the saved CLI session and has not created a deployment.

After publishing the candidate, run from the **existing unlocked Bitwarden terminal**:

```powershell
& 'D:/JOES WIP/ACRUX/Codex Projects/vega/scripts/handoff-operational-application.ps1'
```

The script preserves existing saved passwords, creates hidden restricted runtime URL fields only when absent, activates only password-unconfigured NOLOGIN roles, verifies their exact permissions, updates individual environment variables on the two pinned Render development services and requests the published candidate. Operator credentials never enter application runtime or files. Repeated attempts do not reset configured passwords.

Reauthenticate the Vercel CLI under the existing Acruxfarmer account/team, then the agent can run `scripts/deploy-frontdoor.mjs`. It creates Preview only and refuses an unprotected/wrong project. Do not disable deployment protection or paste credentials into chat.

After handoff: establish the first tenant-native user and explicit staff assignment; verify database concurrency, worker receipts after restart, authenticated member/staff journeys and the protected Vercel route. Broader modules still need operational implementation. Square enablement is not performed by any of these steps.

Final local check: 58 Node tests passed after the protected-handoff corrections; ten synthetic browser checks passed. The frontend build completed. The local review server is http://127.0.0.1:10002. These do not establish hosted authentication or application completion.
