# Layer 3 — public discovery + sign-up/onboarding

Status: BLOCKED — existing Supabase default email sender cannot confirm arbitrary public visitors. Product implementation and Development deployment are complete; the entire signup-to-booking browser journey is not yet verified and the dragon is not closed.

## Implemented journey

Anonymous studio overview → searchable current published schedule → class detail and matching business-owned offers → signup/signin → verified provider identity → studio-specific self participant and member relationship → existing profile/waiver UI → selected class in the existing member booking experience.

Ambiguous email, name or existing linkage is Needs Staff Review. No automatic claim, merge, household, provider replacement, cross-business federation, new payment logic or new schedule engine.

## Public/private boundary

An explicit publication selects existing business class and offer IDs. A restricted read-only database function and a second application allowlist expose only studio copy, class/instructor/time/location/availability and approved matching product terms. Private records and raw state are not returned. Anonymous and authenticated Supabase client roles cannot execute either private function directly. Onboarding uses the server-verified email confirmation and actor; transaction-local authority, row policies, one self participant, existing encrypted receipts and deferred receipt constraints protect the write.

Public calls ignore forged business headers. Authenticated calls remain scoped to actual memberships. Signup has a fixed Development return destination; no caller redirect or role metadata is accepted.

## Development deployment and hosted checks

- Runtime application commit: `2118f5015fde2f08f631a1be9fc6ff2e89469f8f`; Render reported Live, 41.5-second deployment, 2026-10-06 14:33 PDT.
- Runtime: https://vega-development-web.onrender.com
- Vercel Preview: https://vega-development-32pthpnza-acruxfarmer.vercel.app (`dpl_DKHXjNWyCmLrKvNqhi4ZosDpjRWi`, READY, source same commit, Git preview target). Existing protection preserved; browser's existing Vercel session accessed front door. No application member session was present.
- Browser verified Vega overview, three current classes, cancelled state, instructor/time/availability, exact $60/3 classes/30 days offer, matching credit-required class, retained class selection on signup and signin screens, and no browser console errors.
- Browser verified Willow branding, America/New_York times, available/full/cancelled classes, absence of Vega passes, no matching search result, and cancelled detail without booking continuation.
- Empty schedule was browser verified before publishing the three new Vega fixture classes.
- Anonymous HTTP checks passed: both public studios, future classes, full/cancelled states, actual offer price, no private fields, forged scope ignored, private routes 401, missing studio and unsupported query 404. See `hosted-public-api.json`.
- `verify-public-onboarding-development.mjs` ran with the deployed runtime database role for Vega and Willow. Both passed self-member creation, idempotent retry, unchanged unrelated arrays, encrypted receipt insert and `SET CONSTRAINTS ALL IMMEDIATE`. Both transactions rolled back. This is database/runtime verification, not a completed provider email flow.
- Supabase Development site URL changed from localhost to `https://vega-development-web.onrender.com/join.html`; allowed callback `https://vega-development-web.onrender.com/join.html**` visibly saved. Email confirmation remains enabled.

## Business state and reusable fixture

Vega started at revision 155. Three new explicitly marked Development classes and one cancellation used existing authoritative commands, reaching 159. All four independent receipts were acknowledged. Seed fingerprint confirmed purchases, refunds, reservations and participants unchanged. Existing 17 classes remain unpublished; only three new fixture classes are public. Existing approved Development pass is reused without modifying its terms.

Willow is a separate explicit Development fixture (`layer3-reuse-fixture` / `willow-movement`), not a Vega branch in UI logic. It has three classes and no products. After the onboarding rollback checks Vega remained revision 159 and Willow revision 0.

## Tests

- Targeted public entry: 26 tests, all pass (including unconfirmed/anonymous identities and forged confirmation metadata).
- Full tracked repository suite: 1,040 tests, all pass; `tracked-regressions.txt`.
- Real PostgreSQL rollback fixture: public/private isolation, publication allowlist, matching source prices, ambiguous review, retry and second-business linkage passed.
- An earlier exploratory run including pre-existing untracked work: 2,782 tests, 2,776 pass, six fail. All six are unrelated historical source-hash assertions expecting `0a777...` for untouched `src/application.mjs`, whose pre-existing hash is `fb564...`. The untracked work and its expectations were preserved; this is not a green all-workspace result. See `../layer-3-full-regressions.txt`.

## Remaining blocker and completion gate

Supabase currently uses its built-in SMTP sender. Dashboard and provider settings confirm email signup enabled, confirmation required, custom SMTP disabled. Supabase documents that the default sender only sends to project-team addresses: https://supabase.com/docs/guides/auth/auth-smtp . A public visitor cannot reliably finish confirmation. The user has been asked to identify an existing approved SMTP sender/Bitwarden record; no new provider or infrastructure has been created and confirmation has not been weakened.

After that dependency is resolved: verify delivery and callback with an approved test inbox; sign in; create the business relationship; complete the existing profile and required waiver through an authorized test flow; reach the selected supported booking step; verify retry and Needs Staff Review through the hosted authenticated UI. Then issue product completion. The current database checks must not be described as full end-to-end signup verification.

## Intentionally deferred

Communications automation, media expansion, native applications, household/dependents, account merging/federation, new commerce/refund behavior and public publication administration UI. Production was not accessed. Layer 2 remains closed and unchanged.
