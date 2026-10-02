# 6.9 direct payment implementation — local review

Baseline: closed 6.8A candidate `3e0480ad68407cb9c23b62b471a0613fd88cc05a`. Local branch: `commerce/6.9-direct`. No provider credentials are in this change. No deployment, migration, Sandbox payment or webhook enablement has been performed.

## Implemented boundary

`db/commerce-69-binding.sql` prepares the fixed Development binding with restricted read access and conflict rejection. The migration is not installed by application startup. The existing application business-row transaction serializes payment preparation, observations and fulfillment. Duplicate commands retain the existing durable command/acknowledgment path. Provider calls happen outside the database transaction and only after preparation acknowledgment.

Only the designated authenticated self-purchase is eligible. The five closed 6.8A verification draft IDs are explicitly blocked. No client-supplied amount, recipient, provider evidence, merchant or source token is accepted. Staff can view statuses, but cannot initiate or resume a member payment through these endpoints.

Vega pins the merchant `MLJGVWY9QZ66R`, location `L7EMFD4DPV27P`, application `sandbox-sq0idb-iQmG15i6Pe5yMJMLmu_miw`, and Sandbox host. The adapter verifies the credential's merchant/application identity before provider operations, sends USD 6000 with immediate completion, and requires authenticated GetPayment evidence before confirming. No real payment source is collected in the browser: this bounded test slice uses a privately configured Sandbox card nonce. Its digest is persisted for retry identity; its value and the access token are never stored in application state, source, logs or receipts.

One nonterminal attempt per purchase is enforced under the existing business row lock. A UUID is retained as both Square idempotency key and reference. Pending/unresolved outcomes block a new attempt. All retried CreatePayment parameters remain identical. An unknown payment ID may be retried with the original key for at most 15 minutes from intent creation; afterward it remains unresolved and requires operator investigation, never a new automatic charge. Once the provider ID is recorded, subsequent checks use GetPayment. Explicit member status checking resumes durable work after restart; there is no new autonomous payment worker or webhook processor in this slice.

Payment and fulfillment are separate. First verified completion records immutable paymentConfirmedAt and refundWindowStartsAt. An acknowledged confirmation authorizes the existing entitlement issuer, with a purchase-scoped issuance reference and immutable product snapshot. The issuance and fulfillment update commit together. Validity is anchored to paymentConfirmedAt even if issuance happens later. A failed fulfillment leaves payment succeeded and retries issuance only. Existing staff-issued entitlement behavior is unchanged.

## Local evidence

206 tests passed. New tests exercise the real application-store code through a simulated transactional PostgreSQL adapter and a simulated Square provider. Coverage includes concurrent retries, one provider payment, changed payload/source conflicts, pending acknowledgments, lost CreatePayment responses, GetPayment outages, credential/payment/amount/currency/source mismatches, declines and cancellation statuses, fulfillment rollback, immutable clocks, preserved eligibility, duplicate payment ownership, stale observations, role/business boundaries and default-disabled gates. Existing 6.8A and application regression tests pass. Build and whitespace checks pass. Local member/staff rendering is inspected using synthetic states.

These are local tests, not a claim of real PostgreSQL or Square execution. The previous hosted 6.8A concurrency evidence remains closed and unchanged; it is not reused as 6.9 execution evidence.

## Exact next hosted requirement

1. Joe reviews and authorizes the new pinned candidate for Development deployment. Codex validates/publishes Git and verifies a matching protected Preview; Joe performs only the narrow Render/private-secret handoff. Preserve the established baseline lineage and unrelated workspace changes.
2. Separately authorized Development schema installation applies `db/commerce-69-binding.sql` to project `cjdoczrxcjynjhgpgqop`. Verify exact binding, forced RLS, runtime SELECT-only privilege and rejection of conflicting binding. Keep direct execution disabled. Verify default payment routes remain unavailable and closed drafts unchanged.
3. Create and explicitly designate one new unpaid Development draft for the authorized test. Before any provider call, Joe must authorize that draft and the Sandbox test payment. Supply private `SQUARE_ACCESS_TOKEN` and `SQUARE_SANDBOX_SOURCE_ID` through the existing protected workflow; preserve the source across retries. Pin `SQUARE_ENVIRONMENT=sandbox`, the verified `SQUARE_APPLICATION_ID`, `SQUARE_MERCHANT_ID`, `SQUARE_LOCATION_ID`, and `VEGA_SANDBOX_PURCHASE_ID`.
4. Only after that authorization set `VEGA_SANDBOX_PAYMENT_EXECUTION=authorized`; otherwise leave it absent/disabled. This is a narrow Sandbox-only gate alongside `VEGA_ENV=development` and `VEGA_EXTERNAL_EFFECTS=disabled`, not permission for general provider activity. Webhook subscriptions remain disabled.
5. Independently capture database before/after state and allowlisted provider evidence for real concurrent starts, stable retries, interrupted requests, GetPayment confirmation, one payment/issuance, exactly three credits, correct validity/eligibility, immutable confirmation and refund-policy timestamps, member reopening and staff visibility. Reconcile persisted attempts, command receipts and audit events. Test declines/uncertainty only within separately designated approved test intents; do not force uncertain attempts into new payments.
6. Preserve the lack of legitimate additional Development identities as a hosted cross-account/business coverage limitation. Local boundary fixtures do not erase it. Require separate review for webhook handling and out-of-order provider notifications before broader 6.9 completion.

Refund execution, subscriptions/renewals, saved cards, partial payments, tips, delayed capture, other methods, Production and Strata remain out of scope. All Section 6/Sleepy and 6.8A closures remain closed.

Provider references checked during implementation: Square CreatePayment, GetPayment, ApplicationDetails and idempotency documentation. API version pinned to 2026-09-16.
