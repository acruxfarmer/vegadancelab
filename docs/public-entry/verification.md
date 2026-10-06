# Layer 3 — public discovery + sign-up/onboarding

Status: PRODUCT COMPLETE — public discovery, email-confirmed signup, business/member linkage, existing profile/test waiver and selected booking step verified in Development.

## Implemented journey

Anonymous studio overview → searchable current published schedule → class detail and matching business-owned offers → signup/signin → verified provider identity → studio-specific self participant and member relationship → existing profile/waiver UI → selected class in the existing member booking experience.

Ambiguous email, name or existing linkage is Needs Staff Review. No automatic claim, merge, household, provider replacement, cross-business federation, new payment logic or new schedule engine.

## Public/private boundary

An explicit publication selects existing business class and offer IDs. A restricted read-only database function and a second application allowlist expose only studio copy, class/instructor/time/location/availability and approved matching product terms. Private records and raw state are not returned. Anonymous and authenticated Supabase client roles cannot execute either private function directly. Onboarding uses the server-verified email confirmation and actor; transaction-local authority, row policies, one self participant, existing encrypted receipts and deferred receipt constraints protect the write.

Public calls ignore forged business headers. Authenticated calls remain scoped to actual memberships. Signup has a fixed Development return destination; no caller redirect or role metadata is accepted.

## Development deployment and hosted checks

- Runtime application commit: `629e13066c101d1ae8badfe1b88fd1974064360a`; Render Live, 53.9-second deployment, 2026-10-06 15:15 PDT.
- Runtime: https://vega-development-web.onrender.com
- Vercel Preview: https://vega-development-8b3cwjc2i-acruxfarmer.vercel.app (`dpl_GveRuj5ztTwfDzLa231c8FEDXaGk`, READY, source same commit, Git preview target). Existing protection preserved; browser's existing Vercel session accessed front door. No application member session was present.
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

## Hosted email-confirmed onboarding completion

Existing Resend sending-only credential configured in Supabase Development custom SMTP: smtp.resend.com:465, user resend, sender admin@acrux.co (Acrux). Joe entered the credential in the existing dashboard session. Sender domain verified by Joe; no administrative /domains preflight or permission expansion. Management API PATCH returned 403 before configuration; dashboard save and reload confirmed configuration. No new provider or communications automation.

Joe created and confirmed admin@vegadancelab.com and signed into the shared Codex tab. Provider confirmation and last-sign-in facts were verified without reading passwords or confirmation tokens. Hosted profile showed Joe Graham and the accepted synthetic Development waiver (explicitly no legal effect). The selected class opened in the existing member booking dialog: Movement foundations — preview, 12 spaces, eligible to book, no credit required, Confirm booking available. No booking or payment was submitted.

The confirmed actor has exactly one Vega member relationship and one self participant. Retrying onboarding reused it. Four independent recovery receipts are acknowledged. The Willow synthetic-name ambiguity produced Needs Staff Review and no Willow membership. Vega revision is 163; Willow remains 0. Unrelated business fields (excluding participants, customerProfiles, waiverAcceptances and activity) retain before/after digests 16cc7056863b0a3722b16dc30da79baf (Vega) and 1f2c5528cec954d3a8687e0334d4d03c (Willow).

Password UI polish adds required confirmation, independently accessible show/hide eye buttons, unchanged 12-character minimum and a simple mismatch message before the authentication request. Confirmation is excluded from the authentication payload. Passwords are not added to logs, receipts or diagnostics. Existing authentication architecture is unchanged. Hosted browser checks passed: both fields required, masked by default, each toggle shows/hides independently, mismatch blocked with a clear message, editing clears the mismatch, short password rejected. Synthetic inputs were cleared and no test account was created. Profile navigation links were verified to open the existing member screens; the final selected-class dialog again showed the confirmed member eligible to book.

## Intentionally deferred

Communications automation, media expansion, native applications, household/dependents, account merging/federation, new commerce/refund behavior and public publication administration UI. Production was not accessed. Layer 2 remains closed and unchanged.
