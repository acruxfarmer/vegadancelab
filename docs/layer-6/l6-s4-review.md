# L6-S4 — IMPLEMENTED / READY FOR REVIEW

Development only, 2026-10-07. Joe + Chett review required; no next slice started.

## Management experience

`/manage-media.html`, linked from the member/staff Media Library, lists personal resources and business resources the verified actor may manage. Existing account sign-in is available directly on this surface without requiring a business relationship. It reuses the existing auth endpoint and per-tab session implementation.

Personal registration creates an external/reference canonical video owned by the signed-in user. It creates no placement, business relationship or role. Business registration requires existing `customers.manage` authority, an authorized business owner selection and an explicit initial placement policy. Owner, submitter, creator attribution and source reference remain distinct. References are passive records; no provider is contacted or playback availability fabricated.

Standalone title and creator attribution can be edited with revision checks. Source replacement and ownership transfer are not exposed. Linked Layer 5 video metadata/publishing continues through the existing studio library, and linked resource archive remains blocked by the existing coordinated-lifecycle safeguard. Standalone archive is a retained tombstone, not deletion, and invalidates active resource use without destroying placement/audit relationships.

Owners see existing placements and may withdraw them. Personal owners can edit **only Access Availability** on existing authorized placements. Target-business staff see a safe local-placement projection and may manage visibility and existing categories/collections; they cannot change external policy, see private canonical source details or archive/delete the external resource. No second collection system or collection entitlement inheritance was introduced.

## Authority and architecture

- API verifies the provider principal independently of caller-supplied business headers or editable metadata. No staff-role workaround for personal ownership.
- Existing canonical foundation, placement services, staff permission resolver, RLS, revision checks and audit tables are reused.
- `ownerPolicy` requires exact personal canonical ownership, active resource, authorized placement and current revision. Its input permits policy only.
- Private database helpers validate membership references in the placement business and return only catalog ID/name choices to that owner. They return no members, issuances, balances, entitlements or business state. No private business SELECT grants were added.
- Database guards independently reject policy changes bundled with local organization changes and target-staff overrides of external-owner policy.
- ALL/MEMBERS/PAY_ON_DEMAND reuse S3 policy meanings. Membership period qualification, OR semantics, zero-credit validity and non-consumption are unchanged. PAY_ON_DEMAND remains locked with no commercial activation.
- Resource identity/ownership/source remain stable during metadata, policy, organization and withdrawal operations. Future native upload can use the existing source abstraction; none was implemented.

## Implementation and migration

Runtime **49dd90106240001c3221c5c41a45b062cd32b413**, pushed to `product/layer3-public-entry`.

Render Development deployment **dep-db3civ6gekts73e7ftc0** succeeded, live, 40.7 seconds. Existing service branch/configuration preserved.

Migration **20261007222918_l6_s4_owner_management**, source `db/proposals/l6-s4-owner-management.sql`: two narrow owner-policy helpers, owner policy guard, bounded extension of existing placement guard, metadata audit action. No data migration, new role, broad schema grant or temporary elevation.

PUBLIC/anon/authenticated cannot execute any new function. The established `vega_app_runtime` may execute the validator and safe catalog projection; trigger functions are not directly executable by it. Security advisors reported no new findings; pre-existing unrelated [search-path advisories](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable) and [password-protection advisory](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remain unchanged.

Changed files: `src/media-resource.mjs`; existing resource foundation and placement service/repository; new `src/runtime/media-owner-management.mjs`; application API/database/static routing; new `public/manage-media.html` and `manage-media.js`; existing library link; bounded migration; `scripts/verify-l6-s4-runtime.mjs`; resource/placement tests and new management API tests. Exact list: `git diff --name-only e2cc902..49dd901`.

## Verification

**50/50 targeted checks; 1,156/1,156 tracked regressions.** Five additional tests cover metadata identity/audit/stale rules, bounded owner policy editing, verified API identity, server-filtered ownership and rollback. Existing suites retain business isolation, membership validity/OR/zero-credit behavior, independent placement continuity, Layer 5 library/playback and unrelated booking/commerce/entitlement coverage.

Final deployed restricted-runtime `verify-l6-s4-runtime.mjs` passed:

- Personal create, read, metadata edit, archive; unrelated owner denied.
- Business create, metadata edit, existing collection organization/removal, reload and archive.
- Owner policy transitions MEMBERS → PAY_ON_DEMAND → ALL; policy persisted and identity unchanged.
- Owner received no staff/business management choices; no organization controls or business state.
- Wrong product references, unrelated policy edit, target-staff override and stale edits denied.
- **Direct database** owner attempt to change visibility alongside policy denied; direct target-staff policy override denied.
- Foreign Willow private business read denied; withdrawal prevented further policy changes.
- Business state unchanged; all runtime mutations rolled back, including failure paths.

Final deployed S3 runtime proof also passed: actual public/current-membership/zero-credit playback bytes, expiry, paid, unpublished, withdrawal and legacy bypass denial; viewing non-consumptive. Its optional Willow branches remain explicitly NOT_RUN; closed S2/S3 isolation evidence and current unit coverage are preserved rather than claimed as new live Willow playback.

Browser proof with the existing non-staff admin test identity:

1. Registered a personal reference with only personal ownership available.
2. Edited its title, reloaded and verified persistence.
3. Archived it; identity `1c687146-1e55-438e-b0c9-320584c9e37d` remained stable, revision became 3.
4. Database audit read showed `resource_created`, `metadata_edited`, `resource_archived` in order.
5. Inspected the existing personally owned Willow placement: owner policy controls available, business visibility/category/collection controls absent; withdrawn Vega placement uneditable. Existing fixture was not changed.

Business and policy mutations were verified through the deployed service/database transaction; a fresh staff browser login was not required or claimed. New external references do not play: source delivery adapters remain deferred. Existing legacy browser playback was checked separately after management verification: full six-second playback, readyState 4, no media error (`l6-s4-legacy-playback.png`).

Screenshots: `C:/Users/Joe Graham/.codex/visualizations/2026/10/06/01a11304-bc9a-7041-9580-543fd3a47718/l6-s4-owner-edit.png`, `l6-s4-owner-archived.png`, `l6-s4-owner-policy.png`, `l6-s4-deployment.png`.

## Cleanup / preservation

The disposable browser reference and only its three test audit rows were removed after audit proof. A finally-style watchdog also confirmed zero remaining records. All other tests rolled back. No persistent new placement, business relationship or staff/database role remains.

Pre/post hashes agree:

| Record set | Preserved value |
| --- | --- |
| Vega revision/state MD5 | 189 / ec6a3cbc4a395bc350244c228ec85cac |
| Willow revision/state MD5 | 0 / 1e8a823a955d74251b2a56b2cff77cfd |
| Member/business relationships | 2751a1e191d9fa327e62f7fee3adf94e |
| Canonical resources | 465491decf99982e63d25ef67d5cb67b |
| Placements | e40286fb77e8b5a5abde6eaf114e5940 |
| Placement audit | 93a4ec841034b6b644c0c79529f602b3 |
| Resource audit (4 original rows) | 4af261935d0f0465abb061899cad31db |

These checks cover record content, not sequence counters consumed by rolled-back test inserts. No payments, email, SMS, provider mutation, CDN provisioning or Production activity occurred.

## Deferred / unchanged

Personal placement contexts, owner-created cross-business placements/relationships, richer owner-approved access ceilings, negotiations, ownership transfer, source replacement, coordinated archive of linked Layer 5 resources, new source playback adapters, native upload/CDN, commerce, paid entitlements, ads/bumpers and social features remain deferred. No Vega/PDX.Dance-specific management authority was introduced. Layer 5 and closed S1A/S1B/S2/S3 remain intact.
