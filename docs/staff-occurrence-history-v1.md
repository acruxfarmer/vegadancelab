# 6.6 — Staff Occurrence History V1

Status: implemented and locally verified; stopped at the hosted/operator boundary. Not deployed or hosted-verified.

The selected occurrence in Staff Schedule & rosters now has a read-only timeline, including past and cancelled occurrences. Expand Before, After, provenance snapshots, and evidence references to inspect recorded values. Current schedule details remain separate. The member surface receives no occurrence audit history.

## Event contract

`public/occurrence-history.js` exports a pure `occurrenceHistory(data, occurrenceId)` projection and its escaped HTML renderer. It consumes the existing authorized application read, without a new endpoint, schema, audit store, command, or receipt access.

Each V1 event has `contractVersion: 1`, a deterministic projection `key`, recorded `eventId`, bounded `type`, `occurrenceId`, `actor: { id, role }`, `recordedAt`, `requestId`, `reason`, `before`, `after`, `provenance`, and evidence references. Types are `creation`, `edit`, `cancellation`, and `creation-from-existing`. Snapshots expose the existing creation field set without running creation validation, filling defaults, or reading current values to reconstruct the past. Missing fields are the literal `unrecorded`.

Copy provenance contains source occurrence identity/version, recorded source details, and recorded created details. Source and copy histories are looked up independently. The source is never traversed or included in a copy's timeline.

Creation activity and matching creation provenance share one event identity. Edit/cancellation activity joins its corresponding history only through the recorded event link. Exact duplicate evidence is included once. Actor/time/title similarity is never used to merge distinct actions. Records without event identity have deterministic projection-only keys and stay separate, even if otherwise identical; no claim of a canonical identity or deduplication is made when the evidence cannot establish it.

Order is descending recorded timestamp, then ascending stable projection key using code-point comparison. Missing/unparseable timestamps sort last. Raw recorded timestamps remain unchanged. Conflicting values for an explicitly linked action are exposed in `conflictingEvidence` and named in `conflicts`; the normalized single value is `unrecorded` rather than arbitrarily choosing evidence. Inputs are cloned where returned, never mutated.

## Local verification — 2026-09-23

- 123 Node regression tests passed, including six occurrence-history tests: contract/types, linked evidence deduplication, source/copy independence, immutable inputs, ordering/ties, anonymous legacy records, gaps, conflicting evidence, escaping, staff scope, and nonexistent occurrence lookup.
- 25 real PostgreSQL 18.4 checks passed in a disposable loopback database. Two new checks cover persisted lifecycle projection, repeated reads, unchanged complete state/revision/command receipts, member privacy, and business isolation. Existing transaction, stale review, rollback, replay, booking/credit, edit and duplication checks also passed.
- Desktop (1440 × 1050) and mobile (390 × 844) browser checks passed using synthetic local authentication with the real API/domain/projection. Confirmed cancelled and past occurrence access, recorded edit snapshots, escaped evidence text, independent copy provenance, one action per linked event, reload persistence, member exclusion, refreshed schedule agreement, no horizontal overflow, zero mutation requests, unchanged state/revision, and no page errors. Screenshots were visually inspected.
- Front-door build and `git diff --check` passed. Canonical 6.5 hosted evidence SHA-256 remains `4F3C08B37C8640E5A974A4F1C34599B411CDD591C3B01248769CBE8AD64DF49A`.

Browser evidence: `docs/occurrence-history-local/verification.json`, `desktop-history.png`, `mobile-source-history.png`, and `mobile-copy-history.png`. Browser fixture setup intentionally creates synthetic local lifecycle records before the read-only verification baseline. An initial fixture setup passed unsupported metadata into the edit validator; that test setup was corrected to use accepted fields before the successful run. No domain rules were loosened.

## Hosted handoff and architectural limits

Development deployment and authenticated hosted verification remain outstanding. After separate deployment authorization, verify staff history against existing recorded actions, independent source/copy histories, legacy gaps, deduplication, reload persistence, member privacy, schedule agreement, and desktop/mobile rendering without creating hosted lifecycle actions just for this read-only slice. No hosted request has been made for 6.6.

Ordinary creation records do not retain full snapshots or actor role; cancellation records do not retain complete occurrence before/after snapshots. Those gaps remain `unrecorded`; there is no backfill. V1's bounded contract does not claim to cover separate cancellation-policy changes, reservations, attendance, or credit history. Existing audit surfaces remain intact. Read volume still follows the existing aggregate application read; pagination or a separate history service is not introduced.

R-01 (staff read dependency on Square processing tables) remains deferred. Production, worker, Square and unrelated services remain unchanged; Square stays disabled. No undo, history rewriting, booking/credit effects, recurring behavior, notifications, payments/POS, or resilience changes.
