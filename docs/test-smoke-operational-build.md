# Operational application Test Smoke — 2026-09-21

Active assignment: independently examine the development application and worker against Joe's operational build instruction, canonical Consumer Network Revision 7, adopted module contracts and the Vega architecture addendum. Canonical Test Smoke skill `7367904f1a11c6de9c4a35e817d403393f4250ba` was read completely. No Production judgment is made.

## Executed evidence

Independently executed 14 Node tests in `test/application.test.mjs`, `test/application-api.test.mjs` and `test/worker.test.mjs`; all passed. Coverage includes authenticated identity source, member/staff command policy, member projection exclusions, verified TLS and restricted role URL guards, transaction rollback, worker normalization, mock replay/crash handling, advisory-lock contention behavior and nonoverlapping polling. Mock database tests establish component behavior, not live concurrency.

Actual development database exercises ran through the Supabase connector pinned to `cjdoczrxcjynjhgpgqop`. SQL is retained in `test/application-rls-smoke.sql` and `test/worker-rls-smoke.sql`. Synthetic fixtures and temporary SET ROLE capability were enclosed in transactions and rolled back.

App role exercises passed: scoped membership/state visibility, own-state update, foreign-state update denial, membership mutation denial, DELETE denial, cross-tenant reassignment denial, append-only command receipt, forged receipt actor denial, actor-switch isolation and unassigned-principal denial.

Worker role exercises passed: inbox SELECT, inbox UPDATE/DELETE denial, application membership SELECT denial, observation/receipt inserts, duplicate receipt rejection, observation UPDATE denial and receipt DELETE denial.

Independent post-check confirmed zero retained synthetic app/member/inbox rows. Remaining postgres role memberships have `inherit_option=false` and `set_option=false`, granted by `supabase_admin`; temporary test SET capability did not persist. The first test attempt before temporary grant correctly failed SET ROLE and rolled back, an operator test capability issue rather than a product defect.

Live metadata confirms FORCE RLS on all five new tables and intended grants. Ingestion retains inbox INSERT/SELECT only and no application or worker table rights. App cannot read/write inbox or financial observations. Worker cannot read/write application tables. App and worker roles remained NOLOGIN at this observation point.

## Findings and pending evidence

The earlier staff-draft disclosure and unknown top-level state projection findings are corrected and covered by passing regression evidence.

An independent in-memory probe demonstrated that a staff waitlist promotion can reserve a class that has already started, while the reservation path rejects it. Reported to Astra for correction or an explicitly distinguished retrospective staff correction policy; no such distinction existed in the examined candidate.

Actual simultaneous database application commands, restricted-login runtime operation and hosted front-door/authenticated workflow execution remain unproven by these exercises. Those depend on runtime handoff/deployment work in progress. Square remains disabled. Broader module wireframes do not establish operational payment, content delivery, commerce or external communications completion.

Disposition is interim: valid component and database privilege/RLS evidence is preserved; assignment continues through the reported correction and forthcoming runtime evidence. No new approval gate or owner decision is introduced.

## Final bounded examination

Astra corrected past-occurrence promotion to use the occurrence availability boundary. The independent adversarial test now passes, alongside repeat-cancellation and foreign-participant cancellation checks. No known reported implementation defect remains unresolved within this examined core policy boundary.

Executed all 14 existing `*.test.mjs` files by explicit absolute paths: **52 tests passed, zero failed**. PowerShell variable/glob expansion in this execution environment initially combined filenames into one argument; those two attempts did not execute tests. Explicit paths resolved that test-runner invocation issue. No foundation provider probes were rerun; provider-oriented tests in this suite use their test fixtures/mocks.

Added and executed `test/application-http.test.mjs`: **one additional test passed** against a fresh local server bound to an ephemeral loopback port. All four assets (`/`, `/app.js`, `/integration.js`, `/styles.css`) returned 200 with expected types, no-store, nosniff, no-referrer and frame restriction headers. Configuration reported Square disabled; unconfigured application/auth/ingestion readiness failed closed; a path-traversal request did not serve the target. No external provider request or live effect was required.

Final scope: **53 passing local tests plus executed hosted database grant/RLS checks** support the examined development code, local HTTP serving and restricted database-policy behavior. They do not establish browser layout/interaction acceptance, real simultaneous database-command correctness, authenticated hosted user journeys, runtime credential handoff or Vercel deployment. Parent reports Bitwarden locked and saved Vercel token rejected with 403; those human-authentication boundaries limit hosted evidence. Square remains disabled. This is a completed bounded testing disposition, not full application or Production acceptance.

### Staff processing visibility addition

The subsequent `application-processing-visibility.sql` change intentionally adds app SELECT on inbox/journal through an operator-owned merchant/environment binding and explicit staff Business membership. This supersedes the earlier statement that app had no inbox read capability; app still cannot mutate inbox/journal or access financial observations. The API selects only event id/type/status/reason/time, caps output at 100, and never selects raw payload. The role itself can read matching raw rows inside its scoped server trust boundary; API projection is the payload disclosure boundary.

Executed `test/application-processing-rls-smoke.sql` on the same development project: matched staff can read one bound merchant's inbox/journal; member sees zero bindings/inbox/journal; unknown merchant and another Business are denied; binding/journal mutations are denied. Actor switch to a second staff identity sees only its own merchant. All passed. Post-check confirmed zero fixture state/inbox rows, zero temporary SET grants, and forced RLS on bindings. This targeted retest covers the added read boundary without transferring a hosted user-journey claim.
