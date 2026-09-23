# 6.4 — Staff Schedule Management V1: Single-Occurrence Editing

Status: locally implemented and verified on 2026-09-23; stopped at the hosted Development deployment boundary. Hosted verification remains pending. No Production, Square, worker, provider, environment or unrelated service changes. Square remains disabled.

## Implementation

Staff can edit one upcoming open occurrence from Schedule & rosters. The editor covers the existing creation fields: title, instructor, location, category, capacity, start, duration, cancellation cutoff, credit requirement and waitlist setting. It requires an edit reason, shows each changed field's before/after values, and requires a separate confirmation. Back preserves the proposed details; refresh explicitly starts over from the current occurrence. The original occurrence ID is retained. Staff can inspect attributable edit history on that occurrence; members receive current schedule fields without staff history or controls.

The existing class-creation validation and normalization now live in `src/class-details.mjs`. Creation, edit review and edit commit all call that same function. No competing edit validator was introduced. Existing field bounds, optional defaults and boolean/category normalization are preserved. The creation form's duration maximum was corrected from 1000 to the existing server maximum of 1440 minutes, so the client no longer contradicts that creation rule. Editing adds only its own lifecycle/history/review safeguards and disallows unknown edit fields (including identity, status and series fields).

`POST /api/classes/edit/review` is an authenticated, staff-only read with no state write or command receipt. `POST /api/classes/edit` uses the existing command transaction and request journal. The new browser asset is served by the application runtime and included in the allowlisted front-door build. A narrow mobile roster-selector width fix prevents long occurrence titles widening the staff schedule.

## Validation and concurrency

- Any reservation row for this occurrence blocks editing regardless of status. That includes reserved, waitlisted, cancelled, cleared attendance history and cancelled waitlist history. Existing workflows retain these rows; none deletes them.
- The source must still be open and upcoming at commit time. The proposed start must also remain upcoming. Cancelled occurrences cannot be reopened. Empty changes are rejected.
- A source-version digest rejects edits based on a changed occurrence, including changes made before the review request. The review digest binds the normalized proposal, before/after values, reason, occurrence version and authenticated staff identity/context. Changing the proposal or reason requires another review.
- Every commit enters the existing studio state `FOR UPDATE` transaction, rechecks staff authority after lock acquisition, then reruns eligibility, shared creation validation and review matching against the locked current state. A booking committed while an edit waits blocks that edit. Competing edits cannot overwrite each other. If the edit wins first, a later booking sees the edited occurrence through normal booking validation.
- State, attributable before/after audit, activity and durable request receipt commit together. A receipt failure rolls everything back; a same-request replay returns the original receipt without another edit.
- Editing bypasses booking-account initialization. It does not change reservations, credits, entitlements, notifications, payments or unrelated state.

## Verification evidence

| Check | Result |
|---|---|
| Complete Node regression suite | 110 passed; zero failed/skipped |
| Fresh local PostgreSQL 18.4 harness | 20 checks passed; restricted runtime, RLS, authority recheck, rollback, replay and concurrent commands |
| New PostgreSQL edit checks | Read-only review; member denial; atomic edit/audit rollback; replay once; two-editor stale rejection; queued edit blocked by new booking; cancelled history block after reload; booking/edit serialization; staff/member projection equality; no credit change |
| Local Edge/Playwright browser | 8 checks passed; zero page exceptions/application console errors |
| Front-door build | Passed; editor asset included |

Browser evidence is in [class-editing-local/verification.json](class-editing-local/verification.json), with desktop review, mobile edit/review and refreshed member screenshots in that directory. Browser verification uses synthetic local authentication with the real API, domain and projections; database transactions are verified separately against a fresh loopback-only PostgreSQL cluster. This is not hosted authentication/deployment evidence.

The browser journey verifies review without mutation, before/after rendering, returning to a draft, confirmation and staff refresh, member refresh with identical current occurrence fields, hidden staff history, two-tab stale rejection, cancelled-history blocking and mobile review/confirmation. The database harness shuts down its temporary cluster afterward and does not accept hosted database URLs.

Reproduction entrypoints: `node --test test/*.test.mjs`; `scripts/verify-hardening-postgres.mjs` with the existing local `PG_TEST_BIN`; `scripts/verify-class-editing-browser.mjs`; `scripts/build-frontdoor.mjs`.

## Hosted boundary and next slice

No hosted deployment, credentials retrieval, schema migration or environment change was performed. A coordinated Development API/front-door deployment and authenticated staff/member verification still require the existing operator deployment lane and Joe's authorization/credentials where applicable. Verify the real review/confirm route, reload persistence, a second staff session's stale edit, historical reservation blocks, staff-only audit and member schedule agreement. Local completion does not close hosted 6.4 acceptance.

One pre-existing coupling surfaced: every staff application read also queries Square processing tables even when Square is disabled. The local harness originally had only application tables, so its first staff-read test failed; empty local queue tables made that dependency explicit without running ingestion or a worker. A future isolation/resilience slice should consider separating optional processing visibility from core schedule reads. This slice leaves that architecture unchanged.

The history guarantee relies on the existing retained reservation records and shared aggregate lock. Any future archival/deletion or storage-splitting slice must preserve an immutable “history ever existed” marker and the same transactional boundary before changing those foundations. No such change is included here.
