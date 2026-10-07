# L6-S2 — Viewer Access Resolution

Status: IMPLEMENTED; Development candidate deployed; completion blocked on the
temporary Willow identity-fixture authorization described below. Not closed.

## Resolution and enforcement

`resolveMediaViewerAccess` is the canonical presentation-free policy evaluator.
Its server-derived inputs are placement, resource availability, verified viewer
identity, context membership, scoped business state and evaluation time. It returns
only `allowed` and a stable `reason`:

- `public_access`
- `qualifying_membership`
- `authentication_required`
- `membership_required`
- `membership_not_current`
- `placement_unavailable`
- `resource_unavailable`
- `access_policy_invalid`

Public placements do not inspect membership/credits. Restricted placements use
the approved S1B membership OR qualifier, which reuses existing issuance/period
validity through `entitlementActive`. A valid period qualifies at zero credits.
Invalid product configuration fails closed. Identity, business scope and existing
participant linkage are verified independently; ownership grants no viewing
membership or staff role.

`createMediaViewerStore` loads current material and scoped membership from
PostgreSQL. The private material function locks the placement, canonical resource
and existing source-business state for the transaction. It requires a live,
visible placement, active canonical resource, exact existing legacy mapping and
published source video. Only the already-approved private inline MP4 delivery
format is supported. Existing bounded asset integrity checks are shared.

`GET /api/media/placements/:placementId/play` verifies a supplied session using
the existing principal verifier, resolves access server-side and returns MP4
bytes only after allowance. Anonymous requests can use an explicit public
placement. No request-supplied business, resource, participant, role, policy or
asset selection is trusted. Extra query parameters are rejected. Responses use
no-store headers and do not expose source URLs or policy/member details.

The existing legacy video endpoint checks for a placement mapped into its source
business. A viewer cannot omit placement parameters to evade that policy. Videos
without such a placement retain existing Layer 5 behavior. Authorized staff
preview remains a separate existing administrative capability. Library/card UX
is unchanged; locked-media UX is explicitly deferred.

Reason codes remain internal to the resolver/service. HTTP denials retain a
generic customer-safe message. An allowlisted observer callback supports
placement/context/decision diagnostics without tokens, source bytes or member
records. Access decisions are not transferable grants or cached bearer tokens.

## Schema and compatibility

Development migration `20261007203715_l6_s2_viewer_material_bridge` adds only two
private, fixed-search-path functions: `viewer_material` and
`legacy_viewer_placement`. Both execute only through `vega_app_runtime`; PUBLIC,
anon and authenticated receive no access. No table, role, entitlement authority,
asset, canonical identity or existing data is replaced. Existing S1A/S1B records
and closures remain intact. S1B's compatibility preflight delegates policy
meaning to the canonical resolver; it remains a preflight, not a playback token.

## Verification

- 13 new viewer tests; 61 targeted checks pass.
- 1,144 tracked regressions pass; 1,147 hosted-build tests pass.
- Hosted candidate `b74eeebc361d4ae234789fc4925c2c0e21071bbe` is live in Development.
- Hosted real PostgreSQL runtime verifies public bytes, current membership bytes,
  zero-current-credit bytes, exact expiry denial, source-unpublished denial,
  withdrawal denial, legacy URL bypass prevention and non-consumption.
- Zero-credit setup uses the existing accounting function inside a rolled-back
  transaction. Playback does not perform the setup mutation or alter its result.
- No fixture business mutations, new placements or audit records persist.
- Vega remains revision 189 / hash `ec6a3cbc4a395bc350244c228ec85cac`.
- Willow remains revision 0 / hash `1e8a823a955d74251b2a56b2cff77cfd`.
- Existing S1B placement count 2 and audit count 5 are unchanged.

Hosted runtime verification uses explicit existing verified Auth-subject fixtures
and returns actual existing MP4 bytes. HTTP authentication/enforcement is covered
by the API tests. This is not a claim of new placement UI verification.

## Remaining bounded gate

Willow currently has no app-member links. Automatic approval review rejected the
proposed two temporary committed links (existing Development staff and member
accounts) because their lifetime spans the hosted test before explicit cleanup.
The rejected operation made no changes. No alternate insertion was attempted.

To complete the two remaining hosted cases, approve exactly:

1. Add the existing staff fixture and existing member fixture to the synthetic
   `layer3-reuse-fixture / willow-movement` context for one verification run.
2. Run `node scripts/verify-media-viewer-development.mjs --with-second-business-fixture`
   under the existing restricted Development runtime. Willow's product and
   explicit staff assignment, both placements, accounting and publication test
   changes exist only in the rolled-back test transaction.
3. Remove precisely those two temporary links immediately afterward, including
   on test failure. Verify zero Willow links and both original business hashes.

This needs no database role, broad grant, Production access, new identity or
provider execution. The links temporarily exist outside the rolled-back test
transaction; that fact must be explicit in approval. Pending checks are actual
wrong-business membership denial and another placement continuing playback
after the first is withdrawn. Local scope/placement tests already pass, but do
not replace these required hosted checks.

## Deferred

New media delivery/source adapters, CDN/native hosting, external source playback,
locked-card/upsell UX, commerce, direct media purchases, packs/drop-ins, creator
tools, network-context adapters, analytics, and Production. No next slice begun.
