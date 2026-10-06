# Bounded full-refund workflow — local implementation

This is the first refund product slice, not a continuation of administrative platform work. No migration, infrastructure, credentials, provider settings or hosted state were changed. Commerce 6.10 and subsequent sealed source/closure records remain unchanged.

## Application integration

`scripts/start-web.mjs` now selects `refund-web.mjs` and `refund-application-database.mjs`. They preserve the established server, authentication, scoped membership, state-row locking, command ledger and recovery outbox. The separate API/store versions keep closed source bytes intact. `refund-application.mjs` delegates ordinary domain transitions to the closed application, adding a refund transition and reservation guard. No tables or privileges are added.

Staff UI appears on People for the designated paid purchase. It stays disabled unless the Development composition explicitly enables the bounded refund gate. The browser cannot supply authority or evidence. Preparing a refund, confirming submission, inspecting provider status and releasing a conclusively failed hold are distinct staff actions.

## Business contract

The reusable domain module has explicit tenant/business/purchase/payment/actor scope and contains no Vega identity branches. The Square adapter alone pins the approved Vega Sandbox integration, known purchase/payment, $60 USD and three units. A second-business fixture uses the same domain transitions.

Intent creation consumes the unchanged closed evaluator, current purchase/terms/payment evidence, the bounded original command/recovery chain and fresh provider evidence. Original purchase terms must match the original purchase command response. This bounded chain check is not a universal historical completeness attestation. Provider evidence covers the payment, all refund statuses with exhausted pagination, and disputes. Unavailable or conflicting evidence fails closed. The runtime rechecks current membership and integration under the state lock.

The same transaction persists the intent, stable operation/provider key, three credit holds, attributable audit event, command response and recovery outbox. Before dispatch, the independent intent receipt must be acknowledged. A unique internal dispatch command claims the operation once, under the same state-row lock. Commit uncertainty causes no provider submission. The dispatch marker is durably present in the existing outbox before submission; its later independent delivery does not authorize another submission.

States: `intent` → `dispatching` → `pending` / `unknown` / `completed` / `failed` / `rejected`. Pending and unknown retain holds. Confirmed completion retires the exact three unit identities and appends retirement events. Failed/rejected retains holds until a staff release re-reads conclusive failure and transitions to `released`. Terminal evidence cannot be replaced by a conflicting outcome. Released operations cannot be submitted again.

Original purchase/payment/issuance records and earlier events are retained. Hold and disposition are represented by the refund operation and unit projection, with append-only operation/audit history. Original unit events are never erased. Unrelated units remain unchanged. Reservations/promotions for the held participant are denied; held units are not eligible for consumption.

## Provider and recovery boundaries

The adapter uses the existing Sandbox token, token identity verification and registered location. Submission supplies a stable idempotency key and the freshly observed Square payment version. HTTP redirects and automatic application retries are disabled. A timeout or invalid response produces unknown status, never release. Known refund IDs support authenticated read-only reconciliation.

If a submission response is lost before a refund ID is captured, the operation remains held for staff review. A matching amount or empty list cannot infer the operation's outcome, and this slice does not automatically attach an externally discovered refund ID. This is a deliberate recovery limitation, not permission to retry.

Exact-deadline eligibility remains `REFUND_CUTOFF_POLICY_UNRESOLVED`; restored usage remains `RESTORED_USAGE_POLICY_UNRESOLVED`. Unknown provider evidence stays blocking. Closed assessment output continues to carry `executionAuthorized:false`; eligibility does not enable execution.

## Verification and deployment status

- 71/71 targeted local tests.
- 2,564/2,564 full local regressions, including frozen source/closure hash checks.
- Store tests exercise the actual store against a deterministic transactional fixture with state-lock serialization and rollback injection. They are not a new PostgreSQL engine qualification.
- Square responses and failures are simulated. No live Square call or refund was made in this implementation turn.
- A local HTTP smoke test verifies the selected server serves the refund UI and leaves effects disabled.
- Closed evaluator SHA-256: `b07eb348776ccc8b58ed3c98f2483544a787ee3eaa984d29a2a90362768a9968`.

The build is not deployed or activated. Before one actual Sandbox refund: review/deploy this product build with execution disabled, verify staff scope/recovery behavior on the hosted application, and obtain fresh readiness using the actual adapter (including dispute-read access). Execution authorization must then be separately supplied for the exact purchase. No administrative plane, lifecycle migration, new secret authority or new infrastructure is required.

Provider reference: https://developer.squareup.com/reference/square/refunds-api/refund-payment (idempotency, payment version, original payment source); https://developer.squareup.com/reference/square/refunds-api/list-payment-refunds (coverage/pagination).
