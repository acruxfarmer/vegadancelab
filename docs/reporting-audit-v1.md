# Section 4.2 — Operational Reporting & Audit

Comparison: workspace `vega/docs/reporting-audit-acceptance-review.md`. Existing verified booking, cancellation, correction, issuance and credit records are joined read-only; no new records, schema or accounting logic.

Reports now provides member, UTC date range, booking ID, event type, actor and text filters. Event history identifies source IDs, member, booking/class, pass/unit, timestamp, actor, reason, original cancellation and current state. Grant summaries are explicitly not additional credit movements. Exact unit trace exposes consumed-by, restored-from and source-unit links. Current account state reuses staffAccount counts/terms; current eligibility explanations reuse bookingOptions. Existing participation report remains in a collapsed section.

Known data limits are stated in the view: simulated_purchase is a Development grant rather than payment evidence; missing legacy attribution/times remain unrecorded; historical rejected eligibility attempts are not stored. Current eligibility is labelled separately and not presented as a historical rejection log.

## Local verification

- 84 regression tests pass; projection does not mutate source, preserves original classifications and each applied/blocked/unchanged correction, joins actor/pass/unit correctly, and does not double-count cancellation activity. Filters intersect and UTC date bounds are inclusive; members receive no audit projection.
- Browser fixture seeded through real domain transitions verified correction originals, exact restoration/reversal trace, spent-restoration blocking, unchanged repeats, membership issuance provenance, combined member/booking/date/actor filters and filter retention on Refresh.
- Invalid date range produced a clear error. Reload preserved existing records/current state. Expired membership showed two unspent/two expired/zero available. No browser errors.
- Signing into the same local fixture as member and navigating to Reports returned the member account with zero audit filters or staff reasons.
- Fixture is loopback-only and read-only after seeding. No hosted mutations are needed for Section 4.2 verification.

Hosted Preview verification remains pending. Production, Square disabled, worker, unrelated services and temporary health instrumentation unchanged.
