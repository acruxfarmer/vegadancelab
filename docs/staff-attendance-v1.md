# Section 6.1 — Staff Attendance & Check-In V1

Roadmap correction: Section 6 is Studio Operating Core Completion. This completed slice is 6.1; original evidence referring to Section 6 remains historical evidence for 6.1.

Status: PASS — local, real PostgreSQL and hosted staff/member verification completed on 2026-09-22. No Section 6 blockers remain. Hosted evidence: ../vega/docs/hosted-staff-attendance-verified.md in the shared workspace.

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

## Hosted gate completed

Commit bdba9ad68a6bc0d239bff5f8a92c6cdb1651f541 deployed to Development web dep-dapf4qe0tbcc73amlacg and protected Preview vega-development-737dfmc4n-acruxfarmer.vercel.app. Separate real staff/member sessions verified booking 98564638-9935-417f-8a46-8e735cf5c58d: Not recorded → Present → Absent → Not recorded. Repeated Absent save added no event. Both views agreed after reload/session restoration; credits remained five throughout attendance. Member then explicitly early-cancelled the fixture through existing rules, restoring six credits. Seven final audit records (booking, consume, three attendance changes, cancellation, restoration) were identical after staff reload. Member #schedule redirected to #today with zero attendance controls. Staff/member warning/error logs empty; application readiness healthy and Square disabled. API denial, concurrent transaction and exact nonattendance-state invariants are supported by the targeted local/real-PostgreSQL checks above; no hosted token extraction or direct database mutation was used.

No Production, Square, worker or unrelated service change. Square remains disabled. No self-check-in, penalties, waitlist work, recurring scheduling, substitutions, payment/POS, broad reporting or visual redesign.
