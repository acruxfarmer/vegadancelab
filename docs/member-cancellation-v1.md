# Section 3.2 — Member Cancellation Experience

Baseline comparison is recorded in the workspace's `vega/docs/member-cancellation-acceptance-review.md`. Section 3.1 evidence is reused for cancellation access, atomic credit movement, duplicate protection, reload persistence and member isolation.

Changes are limited to the missing member experience: a server-derived early/late consequence names the consumed pass before confirmation; a clear result explains restoration or retained debit; past/attendance-recorded bookings cannot be cancelled by members and explain how to contact the studio. A changed cutoff consequence requires another review instead of silently applying a different outcome.

The cutoff classifier is extracted unchanged from the verified cancellation function and shared with its read-only summary. Member-only availability checks sit before that function. No accounting, issuance, restoration, staff override, schema or authentication subsystem was replaced. Existing locked commands and idempotency remain authoritative. Historical cancellation outcomes are rendered in plain language without changing saved records.

## Local evidence

Final regression suite: 71 tests passed. Build and diff checks passed. One existing assertion was updated from the technical word “reconciliation” to the new member-facing attendance/contact explanation; the rejection status and authorization boundary are unchanged.

- Seven new domain/presentation tests cover exact-cutoff agreement, changed-consequence rejection without mutation, explicit late acceptance, past/missing/invalid/attendance rejection, unchanged staff reconciliation, duplicate cancellation after class start, own-only summaries, foreign authority denial, no-credit text, and blocked-card/result rendering.
- Browser exercised synthetic local identity/state with real domain transitions using `scripts/serve-member-cancellation-fixture.mjs`. Early confirmation disclosed pass, restoration and original expiry; Keep booking left it active. Double-click confirmation yielded one POST and one restoration. Late confirmation/result explicitly retained the debit. Reload retained the outcome; past and attendance-recorded cards had explanations without cancellation controls.
- Advancing only the synthetic fixture clock across the cutoff rejected the old early confirmation, produced zero restorations, disabled its submit button and displayed Review current booking. Review then showed the new late consequence before another confirmation.
- Existing Section 3.1 hosted evidence remains valid; broad booking and staff-override scenarios are not being rerun.

Preview publication and focused hosted confirmation of the new text/interaction remain pending. Production, Square, worker, unrelated services and temporary health instrumentation are unchanged.
