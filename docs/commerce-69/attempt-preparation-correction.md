# 6.9 attempt preparation correction — local review

Historical parent: `56d03e745add11a253078cdadf9b673f13b64f67`. This correction does not amend that commit or reopen closed 6.8A. No deployment, binding installation, credentials, Square requests, webhook changes or 6.10 work are included.

## Preparation contract

Authenticated `POST /api/commerce/payments/prepare` accepts only `purchaseId` and `requestId`. It validates the existing self-purchase draft and immutable USD 6000 terms, checks the installed exact Development provider binding, and uses the existing business-row transaction lock and durable command fingerprint. Concurrent requests reuse one active attempt; a reused request ID with different contents conflicts. The UUID attempt ID is the stable provider idempotency key/reference.

Preparation requires all of:

- `VEGA_ENV=development`, `VEGA_EXTERNAL_EFFECTS=disabled`;
- `VEGA_PAYMENT_ATTEMPT_PREPARATION=enabled`;
- `VEGA_SANDBOX_PAYMENT_EXECUTION=disabled` explicitly;
- `SQUARE_ENVIRONMENT=sandbox` and the already verified application, merchant and location IDs;
- `VEGA_SANDBOX_PURCHASE_ID` explicitly designating one fresh eligible draft, excluding the five closed 6.8A evidence drafts.

Neither a Square credential nor a card source is required or read by preparation. Preparation never calls the provider adapter, confirmation or fulfillment. It records pending status with `prepared_execution_disabled`, a null source digest and no execution start. Member/staff views show the attempt reference and that execution is disabled. Staff cannot prepare, execute or resume purchases. Existing execution routes remain unavailable while disabled.

The response includes the existing independent receipt acknowledgment state. A pending acknowledgment is not evidence of independent acknowledgment; retry the identical request. No payment or validity/refund clock begins in either receipt state.

## Later execution compatibility

Only a separately authorized execution configuration can resume the same prepared attempt. Before any provider request, that path durably binds the source digest exactly once, records a separate execution request fingerprint and execution start, and requires acknowledgment. It preserves the immutable preparation fingerprint and idempotency key. Changed source retries conflict. The bounded provider retry window starts at source binding for these new preparation-only attempts; historical direct intents retain their existing creation-time window. This compatibility is tested only with a fake provider; it is not authorization to execute a Sandbox transaction.

## Validation and next requirement

211 local tests pass, including the existing regression suite. Added coverage exercises durable commit/reopening, 12 simultaneous same/different-ID requests yielding one active attempt, changed-purchase same-ID conflict, forbidden extra fields, persistence rollback, binding/environment/authority rejection, authenticated HTTP preparation with execution endpoints blocked, member/staff status, and later simulated source binding with stable fingerprints and exactly-once issuance. Disabled preparation leaves credits, passes, issuances, reservations and all confirmation/validity/refund timestamps unchanged and produces zero provider calls.

The tests run real application-store logic against a simulated transactional database, not hosted PostgreSQL. Build and whitespace verification must also pass before review.

Next: Joe reviews the corrected candidate and separately authorizes Development deployment preparation. Preserve the Git/Preview versus narrow Render/private-terminal responsibility split. Install only the verified binding, explicitly enable preparation for a fresh designated draft, and keep execution explicitly disabled. Verify real PostgreSQL concurrent preparation, persisted command receipts, reopening, member/staff status, exact binding and USD 60 terms, unchanged entitlements and null clocks. No credentials or provider activity are needed for that verification. Authenticated cross-account/business hosted testing remains limited by the lack of legitimate additional identities. Production and Strata remain untouched.
