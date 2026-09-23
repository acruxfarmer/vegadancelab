# 6.7 — Staff Schedule Navigation V1

Status: implemented and verified locally, 2026-09-23. Stopped at the Development operator boundary. No 6.7 hosted deployment, push or hosted verification performed.

## Behavior

Staff Schedule & rosters now has a read-only Find an occurrence form: From date, Through date, title/instructor/location search, and All/Open/Cancelled status. Apply filters intersects these choices. All dates clears date bounds; Reset to today onward restores the initial view (studio today onward, all statuses, no text search).

The existing chronological selector lists matching occurrences with start, canonical status, instructor, location and stable identity. Selection is explicit: no occurrence is selected on initial load. A filter application or refreshed payload that excludes/removes the selected ID clears the roster, waitlist, lifecycle controls, occurrence history and occurrence-specific cancellation panels. It never silently selects the first remaining class. Restoring matching results does not restore a cleared selection. A still-visible selected ID survives ordinary data refresh. Full browser reload intentionally resets the in-memory filters and selection; no saved preference or browser storage was added.

Dates use the existing Vega studio timezone, `America/Los_Angeles`, independently of browser/host timezone. Inclusive calendar-day comparisons correctly handle 23-hour and 25-hour days. Results sort by canonical start instant ascending, then occurrence ID in code-point order; missing/invalid starts sort last, appear through All dates and display `unrecorded`. Empty/inverted/invalid range handling never falls back to another occurrence. The default includes earlier starts on today's studio date; it is not a new definition of lifecycle eligibility.

Status is an exact comparison against existing `occurrence.status`; no derived past/upcoming/full status model was introduced. Text is a case-insensitive substring match against current title, instructor or location only, not historical values or authority. No canonical data is changed by filtering or sorting.

## Implementation boundaries

`public/schedule-navigation.js` contains the pure date/filter/order/selection functions and the in-memory filter UI. The staff renderer reconciles selection before dependent panels render. `attendance-ui.js` removes its first-class fallback; `app.js` removes the corresponding staff-only fallback. Existing cancellation-policy and cancellation-record panels now receive a selected-occurrence scope on the schedule; their command paths and non-schedule behavior are unchanged. Existing demo behavior remains separate.

No application/domain mutation, API contract, validation, database schema, RLS, receipt fingerprint, audit/history projection, business timezone configuration, or member scheduling behavior was changed. No new endpoint, payload redesign or server pagination was added. Client filtering does not reduce aggregate payload size. The studio timezone is the existing fixed Vega calendar; multi-business timezone configuration is outside this slice.

## Local verification

- **129 regression tests passed**, including six new navigation tests: studio midnight/year boundaries; spring/fall DST; inclusive day windows; canonical status despite past dates; current-field text search; immutable inputs; same-time ID ties; undated records; invalid ranges; cleared selection; member exclusion; scoped cancellation panels.
- **26 real PostgreSQL 18.4 checks passed** in a disposable loopback database. Navigation operated on authorized persisted reads with unchanged full state/revision and command receipts. Existing business isolation, member denial, rollback, stale edit/copy, replay and history checks passed.
- **23 browser verification groups passed**: four navigation groups plus eight editing, seven duplication and four occurrence-history regression groups. Existing browser tests were updated only for explicit occurrence selection/All dates and an output-directory override, keeping previous slice evidence separate.
- Navigation browser timezone was **Asia/Tokyo**, while Pacific spring-forward and fall-back date windows and PDT/PST repeated-hour order were verified. Desktop **1440 × 1050**, mobile **390 × 844**: screenshots visually inspected and no horizontal overflow. Keyboard selection, duplicate-title identities, escaped location, empty/error states, current selection after refresh, missing selection after a changed GET response, and member route exclusion passed.
- The removal-on-refresh browser case intercepted a synthetic local GET response; it did not delete a fixture or introduce a deletion action. Existing lifecycle browser regressions created only synthetic loopback data.
- Navigation browser captured **zero application mutation requests**, no page errors, unchanged complete fixture state and unchanged revision. PostgreSQL independently compared full command receipts before/after.
- Front-door build and `git diff --check` passed.

Evidence: `docs/schedule-navigation-local/verification.json`, desktop/mobile screenshots, and the `editing-regression`, `duplication-regression`, `history-regression` subdirectories. Reproducible scripts: `scripts/verify-schedule-navigation-browser.mjs`, `scripts/verify-hardening-postgres.mjs`, and `node --test test/*.test.mjs`.

## Hosted handoff and retained limits

Development deployment and authenticated hosted verification require the next operator handoff. Reuse retained occurrences and verify date/text/status filters, explicit identity, excluded-selection clearing, refresh behavior, member exclusion and complete-state/receipt invariance. Prefer read-only checks; do not create new hosted fixtures without separate review.

The existing 6.6 hosted cross-business negative-test coverage limitation remains: hosted policies/assignments were inspected, but the connector denied the runtime-role negative probe. Local real PostgreSQL negative tests passed. Do not widen permissions solely to satisfy that limitation. No 6.7 hosted isolation test is claimed.

R-01 remains deferred. Production, worker, Square and unrelated services remain unchanged; Square disabled. No recurrence, bulk actions, new lifecycle mutations, booking/credit effects, notifications, payments/POS or resilience work.
