# L6-S1B — Universal Media Placement & Access Authority

## Architecture

One `media_private.resources` identity has zero or more `placements`. A unique
resource/tenant/business tuple prevents duplicate placements. Owner authorization
creates a hidden placement. The existing verified principal and business staff
permission resolver (`customers.manage`) govern server-only service calls.
Individual owners need no target-business membership. Business owners use the
same placement service. No ownership, business role or entitlement is issued.

Target staff may change only visibility, explicit access policy and local category/
collection references. Ownership and placement authorization remain with the
resource owner. Revision checks prevent stale changes. Owner withdrawal makes
that placement unavailable without removing the resource or other placements.
Withdrawal is terminal in this slice; reauthorization is explicitly deferred.
The append-only audit records authorizer, context/resource relationship, action,
revision and time. Database guards separate withdrawal from local configuration.

## Access

An active resource, authorized placement and local visibility are all required.
`public` requires no membership entitlement or sign-in for an access decision.
`memberships` references one to twenty distinct existing membership product IDs
from the placement's business. OR qualification uses existing membership periods
and matching authoritative issuance records, evaluated with `entitlementActive`.
The member must have the existing unambiguous business/participant relationship.
Current membership remains sufficient at zero class credits. No credit balance is
read or mutated. Missing/inconsistent issuance evidence fails closed. Class-pack,
drop-in and other credit-product references are rejected.

There is one explicit placement policy; no collection/library policy inheritance
exists. Existing categories and collections remain local organization. A policy
in one business never reads another business's membership state.

## Compatibility and boundaries

L6-S1A remains closed. No existing resource tables, owner rules, video IDs, URLs,
assets, playback routes or Layer 5 library flows change. New placements are
additional authority relationships, not replacements for existing legacy links.
Access decisions are not bearer playback tokens and do not expose source URLs.
Delivery adapters must evaluate the placement at use time; no new delivery
adapter or public playback endpoint is introduced here.

The concrete context adapter uses the existing tenant/business primitive. There
is no supported network or individual-context registry to bind today; adding
such adapters is deferred rather than fabricating context authority. No business
names appear in the model/service/schema; named Development fixtures exist only
in tests and verification scripts.

## Development verification

Migration: `db/proposals/l6-s1b-media-placement.sql`, applied through the established
Development workflow as `20261007201145_l6_s1b_media_placement_authority`.
Adds two private tables, three narrowly scoped functions, RLS policies and one
guard trigger. No new role, schema grant, temporary elevation or existing-object
permission change. The one security-definer function returns only an authorized
placement's resource-active boolean, never its source or canonical document.
The other functions are security-invoker. Browser roles have no object access.

The initial migration submission was rejected by automatic approval review for
insufficiently explicit owner/context predicates. No change occurred on that
attempt. The applied version uses an explicit owner predicate and a database
guard that prevents target staff from withdrawing owner authorization.

Before/after schema application: Vega revision 189 and state hash
`ec6a3cbc4a395bc350244c228ec85cac`; Willow revision 0 and state hash
`1e8a823a955d74251b2a56b2cff77cfd`, unchanged.

Local verification: 12 new placement tests; 48 targeted tests and 1,131 tracked
regressions pass. Full output: `l6-s1b-regression.txt`. Hosted verification results
and final source/deployment references are recorded in `l6-s1b-checkpoint.json`.

Supabase security advisors report no findings on new media objects. Pre-existing
warnings remain on three unrelated function search paths and leaked-password
protection; those settings are outside this slice and were not changed.

## Deferred

Creator dashboard, new playback/source adapters, network-context adapters,
reauthorization, ownership transfer, direct purchase and credit-based media
qualification, commerce, seller onboarding, native hosting/CDN, transcoding,
marketing and Production activation. L6-S2 is not started.
