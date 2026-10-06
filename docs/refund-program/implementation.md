# Refund Completion Program

Joe + Chett approved the bundled policy on 5 October 2026 (America/Los_Angeles). This extends the product, not the closed Commerce 6.10 assessment contract or the closed first refund. The original completed operation remains immutable commercial history.

## Approved policy decisions

| Policy | Approved behavior | Consequence / limits |
| --- | --- | --- |
| Partial refunds | Whole unused units at frozen purchase allocation | Initial supported allocation is a homogeneous class pack, zero tax, integer evenly divisible frozen pack value. No arbitrary prorating, mixed-price/tax allocation or rounding invention. |
| Used credits | Nonrefundable | Preserve debit and booking history. Remaining unused units may be refunded. |
| Restored credits | One proven restoration of a consumed original unit is refundable if currently unused | Original debit stays spent. Verify cancellation, consume/restore event identity, source unit, participant, pass, original entitlement terms and ordering. Corrections, reversals, re-used restorations and restoration chains remain staff-review cases. |
| Cutoff | Strictly before frozen start plus frozen request window | At/after cutoff rejects both new intent and dispatch. Original terms are not rewritten; the closed evaluator still reports its original boundary reason. |
| Reservations | Resolve active/unresolved reservations using existing booking/cancellation rules first | No implicit cancellation. Initial guard conservatively covers the affected participant. |
| External refunds | Record exact provider evidence and hold available affected rights for review | Never submit another refund. Confirmed failure can release; completed exact whole-unit allocation can retire selected units and release the rest after explicit staff review. Inexact allocation, overlapping unresolved operations or conflicts remain held for review. |

`whole-unused-credit-refund/1` is the newly approved business disposition policy, captured on each new operation with the frozen-terms digest. It is an additional approved refund concession; it does not amend, reconstruct or overwrite original full-only acceptance terms. No claim of historical completeness follows.

## State and execution

New operations use `refund-program/1`, distinct from closed `bounded-full-refund/1`. Request identity binds actor, tenant, business and purchase; selected units and reason are checked on replay. Intent, hold, audit, immutable command receipt and recovery outbox commit in the existing aggregate transaction. Membership and registered payment integration are rechecked under lock. Only one active refund per payment proceeds; completed partials permit subsequent partials up to remaining eligible value.

Intent → dispatching → pending/unknown/completed/failed/rejected. A failed/rejected operation remains held until fresh conclusive confirmation permits an explicit release. Completed retires exactly the selected units once. No automatic retry; a dispatch claim cannot be reclaimed. Independent intent acknowledgment precedes provider submission. Lost commit acknowledgment causes zero submission; a lost provider response stays unknown.

Unknown outcomes with no provider ID can be searched through payment-scoped, fully paginated refund evidence. A reason-string match is only a candidate. Staff must explicitly bind the unique candidate; a subsequent read confirms the outcome before any disposition. Missing or ambiguous matches never authorize retry or release. External captures are append-only business operations with `needs-review`; they do not overwrite owned operations.

## Provider and user experience

The reusable domain has no Vega-specific branch; second-business and second-processor fixtures exercise it. The concrete adapter remains the registered Vega Development Square Sandbox integration. It compares payment/refund/dispute evidence, checks identity and payment version stability, distinguishes provider balance from business eligibility and caps provider refund count at 20. See [Square refund semantics](https://developer.squareup.com/docs/payments-api/refund-payments) and [refund lookup](https://developer.squareup.com/reference/square/refunds-api/get-payment-refund).

Staff can inspect purchase-scoped history and readiness, select whole credits, review external allocation and perform explicit recovery without resubmission. Members see only their own buyer-and-participant-authorized safe refund status/history. Provider identifiers, staff reasons and private receipt bodies are absent from member history. Original offer terms remain visible separately from the additional approved business policy.

Provider submission requires a separate disabled-by-default `VEGA_REFUND_PROGRAM_EXECUTION=authorized` gate and one exact `VEGA_REFUND_PROGRAM_PURCHASE_ID`. The old one-refund gate is preserved disabled. Read-only comparison and staff recovery do not require enabling provider execution. No new infrastructure, migration, permission expansion, administrative plane or buyer-private receipt dependency is introduced.

## Verification boundary

## Robust product scope

The robustness review confirms the supported workflows above as the product boundary. Disputes, complex correction/restoration chains, amended terms, unproven allocation and contradictory history require staff review; there is no automated adjudication or historical repair. Detecting these conditions protects normal refunds and does not require implementing their resolution before the product is complete.

No new business dependency or edge-case automation was needed or removed. Existing identity, amount, lineage, duplicate, concurrency, hold and outcome checks remain financial/data safeguards. UI cleanup presents unsupported evidence as **Needs Staff Review**, gives ordinary blockers actionable wording, and keeps internal reason codes out of the presentation. Provider and business authority remain separate. No infrastructure, schema, permission or execution-gate changes are part of this cleanup.

Local tests cover domain, provider fixtures, concurrency, store rollback/outbox, API denial and safe projections. Hosted verification uses the deployed tests, current authenticated staff UI, actual read-only Square inventory and before/after revision/digest inspection. New partial/refund scenarios are not represented as actual Square executions. Final Sandbox execution of new scenarios requires a fresh approved purchase and separate authorization; the already-refunded purchase is never reused for another refund.
