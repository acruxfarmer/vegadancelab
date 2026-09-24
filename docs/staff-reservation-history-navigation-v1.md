# 6.10 — Staff Reservation History Navigation V1

**Implemented / Locally Verified — stopped at Development operator boundary.**

Joe explicitly resumed the preserved proposal after 6.12 closure. The original proposal in vega/docs/staff-reservation-history-navigation-v1-proposal.md remains unchanged; its historical deferral is superseded by this authorization record.

## Implementation
Event-type and text filters operate only on the existing 6.9 projection for one selected reservation. All events plus the five existing contract types are offered. Search covers displayed recorded details, including disclosure content, with case-insensitive whitespace normalization; current participant/booking values are not historical search input.

Full timeline count, event IDs, projection deduplication and deterministic order remain unchanged. Visible/full counts, reset, distinct no-match/no-history states and keyboard focus are provided. Unlinked supporting evidence remains separate, unfiltered and counted separately. A full-timeline conflict warning survives filtering.

Filter state belongs to the exact reservation selection. Same-reservation refresh preserves filters against new projection data; reservation, occurrence, page, scope, hidden/unavailable row and sign-out transitions clear stale context. Full reload starts without selection or filters. No event-selection state, new endpoint, canonical record, schema, permission or business-rule changes.

## Verification
- 152 Node regression tests passed. Includes all five types, combinations, case/whitespace, empty/reset, order/IDs, immutable evidence, current-value exclusion, unlinked evidence and conflict warnings.
- Selection-lifetime tests cover refreshed evidence, another reservation, business/authority changes, hidden/unavailable rows, occurrence/page clearing and zero mutation calls.
- 30 disposable PostgreSQL checks passed using the existing fresh loopback cluster harness. Added filtering over persisted projections retains complete state/revision/receipts and member/foreign-business exclusion. No hosted database used.
- Authenticated synthetic browser: exact reservation identity, distinct participants with identical names, combined and type filters, keyboard apply/reset, same-reservation refresh, empty/reset, roster exclusion/no substitution, occurrence/page/reload clearing, stable IDs after reload, legacy no-history state, sign-out and member exclusion passed.
- Actual viewport dimensions 390x844 and 1440x1050; no horizontal overflow. Mobile and desktop filter/event rendering visually inspected in task screenshots. Prior hosted viewport limitation remains unchanged.
- Synthetic fixture final read evidence: stateUnchanged true, revisionUnchanged true, revision 10. All ten commands were fixture setup before browser navigation; no browser business mutations.
- Front-door allowlist build and git diff --check passed.
- Canonical 6.12 hosted report SHA256 remains F4DE5FB1E6FE954AA5DE4404A4A32D8E5D57BAA62B32E203C4E8158258E7EFCB.

Reproduction: node --test; existing scripts/verify-hardening-postgres.mjs with local PG_TEST_BIN; scripts/serve-history-navigation-fixture.mjs for authenticated browser inspection; scripts/build-frontdoor.mjs. Browser fixture credentials are synthetic staff@local.test / member@local.test with password synthetic. No real credentials required.

## Architecture and remaining boundary
No new architectural blocker was discovered. Existing evidence-link conflicts and unrecorded gaps remain authoritative limitations; filtering does not resolve or reinterpret them. The aggregate payload and projection cost are unchanged and no pagination/redesign was introduced.

No Development deployment, hosted mutation, commit publication or Production change performed for 6.10. Next step requires separate Development deployment authorization and an exact pinned operator handoff. Hosted checks should be authenticated, read-only, using retained fixtures and before/after state/receipt fingerprints. No new fixtures solely to eliminate coverage gaps.

6.12 is Complete / Verified / Approved / Closed in its separate closure record; canonical hosted evidence is untouched. Preserve the 6.11/6.12 durable-notice foundation, outbound SMS/email as an explicit future requirement, R-01, and every existing isolation/DST/mobile/retained-fixture limitation. Production, worker, Square and unrelated services unchanged; Square disabled.
