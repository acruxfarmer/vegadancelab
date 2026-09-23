# 6.8 — Staff Roster Navigation V1

2026-09-23. **Approved implementation completed and verified locally; stopped at the Development operator boundary.** No hosted deployment, hosted verification or closure is claimed.

## Implemented

Authorized staff can filter the reservation roster of one explicitly selected occurrence by participant display name, canonical booking status (`reserved`, `waitlisted`, `cancelled`) and current attendance status (`present`, `absent`, `not_recorded`). Filters intersect, trim name queries and ignore name-query case. Defaults show all rows. Missing legacy attendance uses the existing `status || 'not_recorded'` normalization; unknown stored values remain visible under All and are not classified as a known status.

The view shows visible/total reservation-row counts, a reset control, and distinct no-reservations/no-matches states. Duplicate names and repeated historical bookings remain separate, in existing canonical roster order, with already-authorized participant and reservation IDs shown. No new personal fields are fetched or exposed. Display values are escaped.

Filters persist on same-occurrence refresh. Changing/clearing occurrence, leaving the schedule, changing authority scope, or reloading clears obsolete context. Existing attendance dialogs are invalidated when their roster identity/context disappears. A generation guard prevents a late attendance response from replacing a newer participant dialog. These are navigation-context guards; existing server eligibility, validation, concurrency and audit rules are unchanged.

Full-roster booked totals, capacity, waitlist ordering/promotion options, editing/cancellation eligibility, history and credit behavior continue reading full canonical data. Filtered rows are used only for displayed roster rows and valid visible dialog context. No new lifecycle operation, payload field, endpoint, schema, permission, preference persistence or business-rule input was introduced. The only runtime routing addition serves the new static JavaScript asset.

## Local verification

- **133 regression tests passed**, including four new roster-projection tests covering combined/current-state filters, duplicate names, stable order and identities, immutable inputs/full totals, unknown/legacy statuses and staff/occurrence scoping. HTTP asset delivery is checked.
- **28 real PostgreSQL 18.4 checks passed** in a fresh disposable loopback cluster. Two new checks verify unchanged complete state/revision/receipts and existing eligibility projections during roster filtering, plus member and foreign-business exclusion. Existing atomic booking, attendance, cancellation, editing, duplication, history and RLS checks remain passing. Hosted databases and permissions were not touched.
- **28 browser verification groups passed:** five roster groups, four schedule navigation, eight editing, seven duplication, four occurrence history. Existing regression scripts regenerated their local screenshots; prior hosted canonical reports remain unchanged.
- New browser fixture uses synthetic authentication with the real application API/domain/projections. Two people have the same long escaped display name, one participant has a cancelled historical booking plus a current reservation, and two entries wait on the full occurrence.
- The navigation-only checkpoint sends **zero mutation requests** and preserves the complete fixture state/revision. Two subsequent, explicitly separate local regressions exercise the existing attendance correction and delayed-response behavior. Those synthetic attendance writes are not navigation writes and never contact hosted services. The first correction preserves credit units/events and targets the correct duplicate-name reservation.
- Desktop **1440x1050**, mobile **390x844**, keyboard apply, mobile action access, identity labels and empty states checked. Screenshots visually inspected. No document-level horizontal overflow; the existing roster table scrolls horizontally within its container on mobile so long names/IDs remain legible. Attendance dialog has no horizontal overflow.
- Front-door build passed. Diff whitespace check passed. No browser page errors.

Browser report/screenshots: `docs/roster-navigation-local/verification.json`, `desktop-roster.png`, `mobile-roster.png`, `mobile-filtered-viewport.png`, `mobile-empty-roster.png`.

Reproduction from this worktree: `node --test test/*.test.mjs`; `node scripts/verify-roster-navigation-browser.mjs`; existing schedule/edit/copy/history browser scripts; `node scripts/verify-hardening-postgres.mjs` with the existing local-only `PG_TEST_BIN`; `node scripts/build-frontdoor.mjs`. The PostgreSQL harness never accepts a hosted connection string.

## Architecture and remaining boundary

The existing shared modal needed a narrow context-lifetime guard so a roster action could not survive a changed occurrence or replace a newer participant selection after an asynchronous response. The guard preserves the modal shell and existing attendance command/revision path. Display-name matching never supplies an action identity.

The business aggregate remains the read source; this slice does not improve payload scaling. R-01 remains deferred. Preserve the hosted cross-business negative-test and DST transition-day coverage limitations from 6.7; no permissions or fixture scope were widened to remove them. 6.7 canonical evidence SHA256 remains `198C8DC61760AAA9EAC23A7D8CB148C5CD4D4B89A0DF1B0CC43538DD5125C21A`.

Next step requires a separately authorized Development deployment handoff, followed by authenticated read-only verification with retained fixtures and before/after database fingerprints. No new hosted fixtures without separate review. Production, worker, Square and unrelated services unchanged; Square disabled. No deployment/push/operator script execution performed for 6.8.
