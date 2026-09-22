# Section 6 — Studio Operating Core Completion

The original roadmap ended at Section 5. Joe approved the following extension; no Section 7 is introduced.

| Slice | Status |
|---|---|
| 6.1 Staff Attendance & Check-In V1 | Complete / Verified; approved and closed |
| 6.2 Waitlist & Staff Promotion V1 | Complete / Verified; local, real PostgreSQL and hosted staff/member checks passed |
| 6.3 Staff Class Cancellation V1 | Approved; implementation and local verification complete; hosted gate pending |

Sections 1–5, 6.1 and 6.2 are the verified Development baseline. Each extension reuses the existing class occurrence, reservation, entitlement, authority, transaction and audit foundations.

6.3 adds one reviewed, atomic upcoming-occurrence cancellation using the existing reservation cancellation and restoration operations. Any recorded attendance, including cleared historical attendance and previously cancelled reservations, blocks this operation for separate reconciliation. No expiry extensions, cash refunds, rescheduling, recurring-series management, substitutions, automatic rebooking/promotion, notifications, worker jobs, payments/POS, membership billing or broad reporting.

6.2 completes member join/leave for full classes and explicit staff promotion of the earliest currently eligible waiting participant. No automatic promotion, timed offers, communications, worker jobs, recurring scheduling, substitutions, self-check-in, no-show penalties, payments/POS, membership billing, broad reporting or unrelated work. Production, Square, worker and unrelated services unchanged. Square disabled.
