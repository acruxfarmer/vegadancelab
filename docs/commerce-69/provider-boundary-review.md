# 6.9 provider boundary — joint conformance review candidate

Authority: Joe + Chett issued ARCHITECTURE ALIGNMENT — PASS for the provider-neutral design against Consumer Network Canonical Architecture Revision 7, its adopted downstream records and the Vega operational application architecture addendum. This record requests conformance review of the local implementation. It does not declare joint conformance approval or authorize execution.

Parent candidate: `d53c591208f77153dffbd519c07ad0202e767841`. Existing hosted preparation evidence remains historical evidence for that candidate. Closed 6.8A remains closed. No hosted state, provider credentials, Production or Strata was changed.

## Implemented boundaries

| Layer | Implementation and ownership |
|---|---|
| Owned commerce | `commerce.mjs` retains the existing Development activation wrapper and delegates purchase construction to one scoped, server-offer constructor. HTTP callers cannot choose arbitrary offers/scopes. |
| Owned payment state | `payments.mjs` owns attempts, stable keys, financial intent, confirmation, audit and fulfillment. No native host, merchant/location/application, request shape or status appears in this core. |
| Provider contract | `payment-contract.mjs` defines exact scoped/versioned integration references, financial intent, explicit capability requirements and normalized verified completion. |
| Shared workflow | `runtime/payment-workflow.mjs` coordinates durable preparation, source binding, submission, independent verification and existing entitlement issuance. It never interprets a processor's native request or response. A submit result alone cannot confirm payment. |
| Integration resolution | `runtime/payment-integrations.mjs` resolves by tenant/business and pinned version, and selects the matching adapter. New attempts use the selected integration; existing attempts retain their original integration even after selection changes. Missing/unsupported adapters fail explicitly. |
| Square adapter | `runtime/providers/square.mjs` and `square-configuration.mjs` contain the exact Sandbox configuration, nonce shape, native requests, transport, credential identity verification, status translation and provider-qualified evidence. The existing signature/webhook integration remains separate and disabled; no webhook subscription was added. |
| Development composition | `runtime/direct-payments.mjs` wires only the approved Square adapter and existing explicit Development activation gates. Registering simulated adapters in tests does not activate additional businesses or processors in the application. |
| Existing entitlement issuer | Fulfillment depends on Vega-confirmed state and a purchase-scoped issuance reference; no processor-specific branch selects credits, validity or eligibility. |

## Historical compatibility

The exact historical binding maps to the immutable `vega-development-card` version 1 reference inside the Square integration boundary. Legacy reads return this reference separately, without rewriting the original attempt. Existing snapshots, IDs, request fingerprints, offer fingerprints, commands and evidence remain unchanged. Future normalized evidence and audit events carry scoped integration/transaction references. This legacy mapping must remain supported while historical obligations or records depend on it.

The hosted purchase `86902504-8bbe-4e38-9c99-dfc19b249ee6` and attempt/key `e81f8bc6-b0f8-4896-9708-69db493030c0` are not modified by this implementation. Local legacy fixtures validate compatibility; no live payment was attempted.

## Storage and migration

`db/commerce-69-integrations.sql` prepares a generic integration registry with one selected version per tenant/business, scoped RLS, runtime SELECT-only access and immutable version identity. `db/commerce-69-square-integration.sql` registers the approved Development adapter separately from the generic schema. The old binding table and all historical records remain intact. These SQL files are prepared, not applied or verified against hosted PostgreSQL in this turn.

An integration reference contains only tenantId, businessId, id, version, provider and environment. Native account/configuration and credentials are not core reference fields. A qualified transaction records its integration version, provider, environment and native ID; identical native IDs in different integrations do not collide.

## Local evidence

Final local validation: **220 tests passed**, zero failures; front-door build and Git whitespace checks passed. All external payment responses in these tests are simulated. The SQL migrations have not been executed against a real PostgreSQL instance in this correction.

The existing payment suite exercises the new shared workflow through the actual application-store code with a simulated transactional database and fake Square transport. It retains retry, concurrency, changed source/payload, disabled execution, provider mismatch, interruption, immutable clocks and exactly-once issuance coverage.

`test/provider-boundary.test.mjs` additionally proves:

- The same shared purchase constructor, payment workflow, core confirmation and existing fulfillment logic run against the real Square adapter with fake transport and a simulated second provider with a different native status vocabulary.
- One shared workflow/registry handles 14 businesses concurrently using two simulated processor types. All intentionally return the same native transaction ID; qualified references remain isolated, stable keys are distinct, and each purchase receives exactly one three-credit issuance.
- Cross-business purchase lookup and wrong-business adapter resolution fail. Unsupported capabilities fail before durable preparation or provider submission.
- Selection changes do not redirect an existing unresolved attempt to another integration version. Missing historical adapters fail without another charge or fulfillment.
- Cross-integration completion evidence and provider outages never confirm or issue entitlements.
- Already-confirmed purchases can finish owned fulfillment without resolving or contacting an unavailable adapter. A legacy Square native transaction ID does not collide with the same native ID from a replacement processor in the same business.
- Source checks reject native Square vocabulary in the payment domain, contract and shared workflow.

The legacy compatibility test preserves binding, key, original command identity, offer fingerprint and original native request fingerprint through preparation replay and simulated execution/fulfillment.

## Closure pressure test and limits

Owned purchase/payment/confirmation/fulfillment policies and histories remain Vega responsibilities. Adapters supply external transaction evidence. The substitution and 14-business fixtures demonstrate architectural independence locally, not live second-provider support or hosted multi-business validation. Legitimate additional hosted identities remain unavailable, so that coverage limitation persists.

Provider replacement changes registry selection and adapter configuration for new work; old obligations stay pinned. Vendor disappearance preserves owned intent, outcomes and provenance, but cannot manufacture missing settlement evidence or export regulated credentials. Fees, payouts, settlements and refunds remain outside this slice and deferred to 6.10; no accounting-completeness claim is made.

Next steps require Joe + Chett's joint conformance review, separately authorized Development migration/deployment and hosted compatibility verification. Payment execution remains disabled. No real Sandbox payment, webhook activation or broader provider rollout is authorized by local test success.
