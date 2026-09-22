# Section 6 — Staff Attendance & Check-In V1

Status: implemented; local verification passed; hosted verification pending. Not closed.

## Existing foundation and bounded additions

Sections 1–5 remain the baseline (73915a0213865a2ba28e58a7cb7f688304657487). Existing reservation attendance command, staff authority, tenant aggregate lock, command receipts, session recovery, member attendance labels and audit view are reused. No schema or new subsystem is introduced.

Previously the roster offered Present/undo only; the command overwrote attendance and wrote generic activity without before/after lineage. Section 6 adds Present, Absent and correction to Not recorded; immutable reservation attendance history with actor, timestamp, reason, source request and revision; same-state no-op; optional expected-revision guard for concurrent corrections; required reasons for corrections. Legacy initial attendance state remains honest about missing historical lineage.

The staff roster shows occurrence time/instructor/location/capacity and existing reservations. A confirmation form states the independent outcomes and shows attendance history. Existing Reports projects the same history without new records. Member payloads retain only safe from/to/time history and current status, excluding staff notes and actors. Attendance does not invoke booking accounting, including legacy credit initialization.

## Verification — 2026-09-22

- Full Node regression: 94 tests passed, zero failures (Sections 1–5 suite plus attendance tests).
- PostgreSQL 18.4 native loopback database, production application schema and restricted runtime role: 12 checks passed. Attendance commands demonstrably overlap waiting on the database row lock. Two fresh requests for Present create one history entry; conflicting revision-1 corrections allow one winner and reject the stale correction. A receipt-insert failure rolls back attendance and history; retry commits once and replay does not mutate state. Member command denied. Exact nonattendance aggregate comparison confirms no change to bookings, cancellation fields, credit units/events, passes, payment state or other records.
- Existing PostgreSQL checks rerun: last seat, booking/cancellation/correction/issuance replay, lost commit acknowledgement, transaction rollback, business RLS, staff downgrade and readiness failures.
- Loopback browser uses real transition/visibleState with synthetic authentication: accurate roster; Not recorded → Present → Absent; both history entries and actor/reason visible; repeated Absent save leaves two entries; reload restores Absent and the original two entries. Member sign-in and reload show Marked absent, one credit available, and one credit used for the existing booking. No staff controls/notes appear. Browser warning/error log empty.
- Domain tests also cover clearing attendance, immutable prefix lineage, malformed status/revision, cancelled/waitlisted rejection, correction reason, isolation, audit projection and exact nonattendance-state invariants.

## Hosted gate still required

Deploy the pinned Section 6 commit to Development web only, preserving /health/application. Use the matching protected Preview with separate staff/member sessions. Exercise controlled booking, Present/Absent/correction, repeat save, roster/member reload and session recovery, attendance audit lineage and unchanged booking/credit/payment state during attendance. Record exact booking/history IDs, actor, timestamps, credits before/after and browser errors. Reuse verified staff/member authorization, RLS and request-recovery evidence alongside the targeted tests; do not claim local fixture authentication as hosted authorization evidence.

No Production, Square, worker or unrelated service change. Square remains disabled. No self-check-in, penalties, waitlist work, recurring scheduling, substitutions, payment/POS, broad reporting or visual redesign.
