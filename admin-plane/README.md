# Acrux Administrative Control Plane — first implementation

Exceptional infrastructure only. Booking, commerce, entitlement, attendance,
refund and ordinary business operations have no import or runtime dependency on
this directory. The reusable contract is independent of Vega. Vega Development
is the first explicit target adapter. No migration execution operation is enabled.

## Implemented local package

The signed `acrux-administrative-manifest/1` binds tenant, business, environment,
project/database, adapter, operation, runner version, Git commit, artifact digest,
SQL/payload digest, approval reference, attempt, execution interval, expected
catalog/revision/digest and job/service identity reference. Its signature is an
Ed25519 approval signature; payload, artifact, manifest and journal digests retain
distinct meanings. A digest alone is not authorization.

Only `qualify-direct-route` and `inspect-recovery` are accepted. The process cannot
dispatch migration SQL, even with a signed migration request. The closed runner
and its disabled Development execution guard are unchanged.

The private HTTPS journal checks a token hash with exact manifest scope, allowed
actions, validity interval and revocation flag. Approval signatures are verified
independently. It offers claim, append and inspect, with no remote signing,
replacement or deletion route. Only bounded evidence fields are accepted; raw
exceptions, arbitrary strings, URLs and credentials are rejected. Approval private
key and TLS private key reside on the service disk, never in inherited job
environment. Platform administrators remain trusted and can alter that disk;
hash chaining does not defend against a privileged rewrite of the entire store.

Claim is synchronous under one authoritative process and is durable before its
response. File writes are synchronized; Linux directory metadata is synchronized.
A second process cannot open the writer. A crash leaves the writer lock for
explicit recovery. This deliberately favors stopping over automatic lock stealing.
Local tests establish filesystem/process behavior, not cloud disk or power-loss
durability. Disk snapshots alone must never be used to reset attempts: rollback
can remove dispatch history. Reconcile with provider job records and retained
evidence before unlocking/restoring.

Tokens are loaded at service start in this release. Revocation requires a reviewed
service configuration reload/restart; an operational reload procedure has not
been qualified. Use short, exact-attempt validity and no long-lived broad tokens.

The job verifies the signed manifest and artifact before claiming. Lost claim or
observation-intent acknowledgment prevents database access. Lost result acknowledgment
requires inspection; neither job nor HTTP client retries. Another qualification
attempt cannot bypass an unresolved attempt. A separately signed recovery-inspection
attempt may read the target while preserving the unresolved original record.
Recovery never clears an earlier attempt or grants execution authority.

Vega's adapter verifies the unchanged SQL hash, exact Development identity and
tenant/business. It reuses the closed direct/TLS/session-lock qualification helper.
Read-only baseline/catalog inspection occurs before and after route qualification.
Recovery uses metadata/catalog reads with the same advisory lock and baseline check.
An absent result after uncertainty requires review; fully applied means no replay;
conflicting state stops. A changed baseline fails closed instead of updating it.

## Cloud installation package — NOT APPLIED

One dedicated Render Development private service, proposed name
`acrux-development-admin`, smallest suitable paid compute, 1 GB persistent disk
mounted at `/var/data/acrux-admin`. Auto-deploy off. No shared environment group.
Build: `pnpm install --frozen-lockfile --ignore-scripts && node admin-plane/seal-artifact.mjs`.
Start: `node admin-plane/service.mjs`. Explicit empty pre-deploy command, to be
verified from the actual provider. No migration hook in build/start/pre-deploy.
Only a reviewed pinned build is eligible; publishing that build is still pending.

Disk provisioning must create the approval keypair, journal server certificate/key,
public key and credential-scope registry privately on the cloud service. The
certificate must match its private DNS name, and jobs receive its approved CA.
No generated keys or operational credentials have been created in this slice.
The signing command `node admin-plane/approve.mjs INPUT OUTPUT` is intended only
for the service's authenticated Render shell. A reference in the manifest is not
proof of who clicked approval: the provider's operator audit record must be bound
and reconciled before an operational claim is accepted as qualified evidence.

The isolated service and its one-off job receive only Development direct DB access,
the journal URL/CA, scoped attempt token and signed envelope/public key. No Render
management API key. Application and worker receive none of these values.
One-off jobs inherit their base service environment, so no approval signing key
or journal TLS private key may be in that environment. The base service is an
administrative trust boundary, not a business runtime.

`render-adapter.mjs` prepares the fixed one-off-job request but does not issue it.
Actual job dispatch/identity attestation needs the established provider control
plane. Job identity in a signed manifest must be reconciled to a returned Render
job ID, commit and status; it is not independently authenticated by a supplied
environment variable. No job has been created. The approval/claim bootstrap and
binding of provider job ID must be rehearsed before any readiness claim.

## Worker window

For eventual separately authorized installation: capture worker identity, active
commit, auto-deploy/trigger, hooks digest and pending deployments; approve and
disable auto-deploy for a bounded window; exclude manual deployments; verify no
pending build/deploy and unchanged commit/hooks. Do not stop ordinary worker
processing automatically. Reconcile migration outcome, then restore the exact
prior auto-deploy/trigger and verify. Unknown outcome leaves a reported held window
until reviewed; never silently restore or leave it disabled. The local comparator
implements the evidence checks. Provider mutation controls remain unexecuted and
unqualified. The current user has not authorized changing worker settings.

## Decisions blocking hosted qualification

1. Paid Render service/disk and one-off-job usage, including actual account price.
2. Direct networking: current Supabase guidance lists Render as IPv4-only; the
   recorded direct endpoint is IPv6. Approve the Development direct IPv4 add-on
   (documented approximately $4/month, requires eligible plan), or establish a
   verified direct route without changing architecture. Never substitute pooling.
3. Secret-backed cloud provisioning: direct credential from authenticated provider
   configuration, no password reset, no workstation migration runtime; separate
   disk signing key, TLS identity and exact-attempt token provisioning.
4. Provider authorization/job-ID evidence flow and journal restart/revocation/recovery
   procedure. These are part of the same bundled qualification, not new slice requests.

No cloud infrastructure, billing, provider networking, worker settings or secrets
were changed. No Development connection was made. The no-RLS inert-installation
exception remains subject to final migration approval. Development remains NOT READY.
Revision 127 is an expected baseline, not a new live observation.

Preserved: `provider_unknown`, `REFUND_CUTOFF_POLICY_UNRESOLVED`,
`RESTORED_USAGE_POLICY_UNRESOLVED`, `executionAuthorized:false`; historical/provider
completeness and refund readiness remain unestablished.

References: https://render.com/docs/one-off-jobs ; https://render.com/docs/disks ;
https://supabase.com/docs/guides/troubleshooting/supabase--your-network-ipv4-and-ipv6-compatibility-cHe3BP
