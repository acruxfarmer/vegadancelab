# Section 3.3 — Member Portal View & History

The pre-change comparison is recorded in workspace `vega/docs/member-portal-acceptance-review.md`. Verified Sections 3.1/3.2 supply existing booking, cancellation, credit movement, duplicate protection, authentication and member isolation evidence.

Today now presents one account overview with upcoming bookings, current credit terms and availability, past/attended classes, recent cancelled bookings and dated booking/cancellation activity. My bookings retains all booking records with explicit attended, absent, unrecorded and early/late labels. Passes & membership uses the same credit presentation. Existing actions and refresh paths remain authoritative.

The only backend addition is a read-only own-member summary. The verified eligibility window comparison was extracted unchanged for reuse; class-specific eligibility still belongs to the existing selector. Available-now totals exclude expired/future credits and explicitly remain subject to restrictions and class-start validity. Available restored units identify their original cancellation provenance without using staff audit data. No schema or mutation subsystem was added.

## Local evidence

- 76 Node tests pass, including five new tests covering validity boundaries, agreement with the booking selector, current/restored/expired/future credit state, attendance distinctions, member isolation, escaping and empty state.
- Build and diff checks pass.
- Loopback browser fixture verified one upcoming reservation, attended/absent/unrecorded past bookings, early/late outcome wording, two currently available credits, one expired and one future unit, restored provenance, plain product labels and dated activity.
- Reload and Refresh schedule & credits preserved the same summary. My bookings and Passes & membership reflected the same records. No private other-member data appeared; browser error log was empty.
- Production, Square, worker, unrelated services and health instrumentation unchanged.

Development Preview and hosted verification remain pending; local synthetic data does not establish hosted completion.
