# Development independent receipts

`vega_private.app_commands` remains a local transactional command journal. It is not an independent recovery receipt. Business aggregate changes, command identity and encrypted `recovery_outbox` payload commit together. A deferred database constraint rejects an aggregate update without its matching intent.

The dedicated `scripts/start-receipt-worker.mjs` process uses `vega_receipt_runtime` and the existing Development B2 writer. It has no business-state authority and does not run Square processing. It verifies its restricted database authority on startup. Only the application receives `RECEIPT_PUBLIC_KEY`; neither application nor worker receives the private recovery key. The worker receives `RECEIPT_DATABASE_URL`, Development archive writer configuration, `VEGA_ENV=development` and `VEGA_EXTERNAL_EFFECTS=disabled`.

## Confirmation and retries

An unacknowledged business command returns HTTP 202 with an operation ID, without final domain confirmation. The same authenticated actor can check `/api/recovery/operations/<operationId>`. The browser retains its request ID, polls briefly and labels read/reload views provisional while business receipts remain outstanding. Retry the same intent using the same request ID; never invent another ID to bypass pending delivery. An acknowledgment is returned only after validated B2 object/version metadata has been persisted locally.

The worker leases pending rows, retries unconfirmed delivery with bounded backoff, and reclaims expired leases. Lost acknowledgment can leave an existing B2 artifact plus pending local state. Retry uses exactly the original encrypted bytes, event ID, object name and digest. Multiple identical B2 versions are one logical receipt. Conflicting copies for one ID must stop reconciliation. Earlier unacknowledged business revisions prevent later revisions from being delivered out of order.

Security termination is fail-safe and immediate; independent evidence archival is durable but non-blocking. Tenant-native provider revocation and local clearing do not wait for archive delivery. The application attempts asynchronous durable security-evidence capture after provider confirmation. Process loss or database failure before capture is an explicit evidence gap; it must not restore the session or be described as archived. Security evidence never makes acknowledged business state provisional.

## Operator inspection

Using the existing protected Development operator workflow, inspect only metadata such as event ID, event kind, state, attempts, available/lease times, last error, object/version and acknowledgment time. Do not print decrypted customer payloads or credentials. A `retry` state reports an unconfirmed outcome, not proof that B2 rejected the upload. Investigate sustained pending age, wrong writer scope, missing keys and worker readiness failures. Do not manually mark receipts acknowledged to clear the backlog.

The operator-only `src/recovery-reconciliation.mjs` can decrypt separately retrieved copies, check immutable digests/identity, deduplicate and apply a committed-result delta against the exact prior state/revision. Missing baseline or predecessor evidence fails closed. Keep historical recovery keys in independent custody. Do not rotate a key by replacing old custody records.

## Rollout and limits

Migration is additive but deliberately makes older code's business mutations fail closed once the mandatory-outbox trigger is installed. Coordinate the Development migration and pinned application deployment; a short business-write interruption may occur. Do not remove the outbox or trigger as an automatic rollback, discard pending evidence, or run older mutation code against this schema. Keep sign-in/sign-out and safe reads available; inspect and fix the Development deployment forward if cutover fails.

No historical command is claimed independently archived. Version-bound receipts require an independently recoverable baseline and uninterrupted predecessor chain. This mechanism does not establish full-system recovery, archive retention/immutability, provider IAM qualification or Production readiness. No destructive recovery drill is part of this slice.

Universal/Network identity and tenant-native authentication remain separate authority and credential domains. A Universal provider session must not become a tenant-local provider credential. Context navigation, local authority/membership revocation, network authentication and network entitlement remain distinct future integration concerns; none is implemented by this remediation.
