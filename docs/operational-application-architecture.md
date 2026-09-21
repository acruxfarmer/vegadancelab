# Vega operational application architecture addendum

2026-09-21 · Archie, canonical skill revision `7367904f1a11c6de9c4a35e817d403393f4250ba`.

This addendum applies the [approved architecture](../../docs/consumer-network-architecture.md) to the operational application build authorized by Joe today. The former [world architecture pointer](../../docs/acrux-world-architecture.md) resolves to that same record. Provider selection, runtime handoff, backup/restore, verified database TLS and hosted durable ingestion remain settled. This is an implementation contract, not a claim of deployed or tested completion, and introduces no internal approval gate.

## Application and authority

Vercel delivers the public and signed-in front door; Render owns application processing and the worker; Supabase remains the tenant database and authentication rail. The browser receives only public configuration and its own session. Privileged keys and restricted database connections remain server-side. Ordinary tenant operation has no Consumer Network dependency.

Begin with the established single Vega Tenant, Business and studio. Preserve explicit tenant, business and location references so expansion never broadens authority implicitly. A verified authentication subject resolves to a tenant-owned account and explicit role/profile assignments. Browser-submitted role, customer ID, tenant ID or editable user metadata cannot grant authority. A login, payer, participant and person controlling a profile remain distinct. Customers see their authorized participant records; staff permissions have explicit resource scope. Public schedule/catalog data must use a deliberately limited projection.

RLS and grants must fit the actual application identity, with default denial for unassigned principals. An authenticated role alone is insufficient. Any connection-scoped principal context must be set transaction-locally and derived from a verified session. Never reuse the ingest identity for application mutations or introduce runtime postgres/service-role access to bypass missing policies.

## Core workflow contract

The canonical Vega scope includes classes, reservations, waitlists, attendance, memberships/passes, member profiles and dashboards, video, events/tickets, merchandise, communications, and staff/admin/reporting surfaces. A complete functional wireframe should expose these areas, while distinguishing available operations from an unconfigured or disabled external effect. Product price, offer, class and content examples must be labeled development data. No fabricated operational history or provider completion may appear as fact.

The existing `reserveClass` policy establishes the first active workflow. Persist reservation and idempotency receipt in one transaction, locking the authoritative session/allocation before counting and consuming capacity. Bind a request key to actor/scope and command content; identical replay returns the original result, changed content conflicts. Concurrent requests for the last seat cannot both succeed. Waitlists do not consume a seat until an authorized promotion commits. Cancellation releases capacity once and retains history; attendance is a distinct staff-authorized outcome. Payment, participation, pass consumption and delivery status remain separate.

Membership state belongs to its module; booking may invoke its allowance contract but must not silently rewrite unrelated membership or payment state. Communications record sender, purpose, channel, preference/suppression decision and delivery status; booking is not marketing consent. Events and commerce maintain their own admission/stock authority. Durable intent or draft state can be functional while outbound payment/message execution is disabled, provided the user sees that state accurately.

## Worker and Square boundary

Keep `vega_ingest_runtime`, its role membership, and the immutable `square_webhook_inbox` INSERT/SELECT contract unchanged. A separate restricted worker identity may SELECT the inbox and mutate its own processing journal, observations and authorized downstream state. It receives neither destructive inbox privileges nor broad schema privileges. An application identity receives only its required application capabilities. Provisioning these scoped identities is an ordinary authorized development implementation action.

The minimal worker path is a durable event receipt plus immutable normalized financial observation, with a unique qualified source identity and processing outcome. Claim/process/receipt must be transactional, or use a recoverable lease with atomic final commit. Concurrent workers and crash/retry cannot create duplicate effects; do not mark complete before downstream commit. Invalid/unsupported observations retain an actionable reason and bounded retry/reconciliation disposition. Health and last successful processing are operational evidence, distinct from process liveness.

Qualify provider resource IDs by environment and merchant, retaining location where supplied. Preserve integer minor-unit amounts and currency. Webhook arrival order does not establish authoritative state; opaque version tokens are not sortable. Older or ambiguous observations must not regress a newer projection. Keep provenance and reconciliation-required state when authoritative resolution is unavailable. A payment observation never implies attendance or booking authority; a pending refund is not a completed refund. These rails apply the adopted [Square semantics](../../docs/strata-studies/square/Square-Semantics-and-Migration-v0.1.md) and [operational correction findings](../../docs/strata-studies/operational-maturity-closure/Implementation-Corrections.md).

Square remains disabled during this build. Synthetic development observations can prove the downstream path without enabling subscription delivery or making outbound Square mutations. Readiness requires durable processing, replay/concurrency/crash safety, malformed-event handling and accurate application visibility; any eventual enablement must preserve the explicit user boundary. Production remains outside today's authorization.

## Conformance evidence to retain

Record end-to-end evidence for public schedule access, tenant-native authentication, customer/staff isolation, reservation/replay/capacity behavior, cancellation and attendance separation, persisted workflow state after restart, worker processing/retry, and the Vercel-to-Render application path. Show disabled external actions and empty/unavailable states truthfully. Reuse settled infrastructure evidence; investigate it again only when an actual implementation failure requires it. These are implementation verification needs, not new human approvals.
