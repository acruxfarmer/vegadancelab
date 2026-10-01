# 6.8A persisted-offer equality correction

Parent candidate: b02a967ebb3ae5dc0bca490b8168c8002b753334. Baseline: 44f058be16c02b31105cb53bd742bf27beeda45c.

PostgreSQL jsonb reorders object keys. Strict deep equality replaces serialized string equality for the selected stored offer version. Object property order is irrelevant; missing/additional properties, value types, nested terms and array contents remain significant. Offer selection, request identity and duplicate handling are unchanged.

Local validation: 192 tests passed, including recursively reordered persisted-state fixtures, independent second draft creation, duplicate retry, and changed/missing/additional immutable fields. Existing application regression tests passed. These tests do not claim real PostgreSQL concurrency coverage.

## Hosted verification after separate deployment authorization

1. Pin the new correction commit and verify ancestry through b02a967 and 44f058b. Deploy Development web and matching protected Preview only through the established split: Codex Git/Preview; Joe's Render-only private handoff. Do not reuse the old pinned deployment manifest or deploy script unchanged.
2. Reconcile deployment receipts, exact commit, protected Preview, authenticated catalog and account assignments. Confirm Square disabled and Production unchanged before mutations.
3. Record database before-state for purchase drafts, commands and activity; passes, credits, issuance history, reservations and financial observations. Preserve the original draft 87d6177e-2988-4aab-973a-5e424ee9c2db.
4. With the existing member, create a second independent draft using a fresh request ID after the persisted offer is loaded. Confirm a distinct ID, then reload and reopen it. Staff must see that same draft.
5. Through an authenticated verifier with credentials retained privately, submit simultaneous requests with the same fresh request ID. After acknowledgment, require one draft, one command and one creation event; retries must resolve to the same draft. Also submit two distinct fresh request IDs simultaneously and require exactly two drafts. Changed payload under a reused request ID must conflict without a further write.
6. Reject member financial/recipient/identity overrides, staff purchase creation, and anonymous requests. Test authenticated other-member and other-business reads/writes only with separately provisioned legitimate test identities; current Development has only one member assignment and one business. Do not fabricate tokens, alter permissions or claim these checks passed without those identities.
7. Verify every new draft has the approved product, 3 credits, 30-day validity, Pack verification eligibility, USD 6000 subtotal/total, zero Oregon Development tax, Development-only price label and exact immutable refund terms. All drafts remain unpaid/unfulfilled; paymentConfirmedAt, validFrom, expiresAt and refundWindowStartsAt must be null.
8. Compare before/after collections to prove zero new credits/entitlements and no reservation changes. Confirm no new payment/refund/provider observations, Square remains disabled, and no provider calls were introduced. Save sanitized receipts and member/staff screenshots outside the candidate.

No deployment is authorized by this review document. No 6.9 work, Production changes or changes to the closed Section 6 remediation are included.
