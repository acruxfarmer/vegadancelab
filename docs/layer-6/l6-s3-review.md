# L6-S3 — IMPLEMENTED / READY FOR REVIEW

Development verification: 2026-10-07. Awaiting Joe + Chett review; no next slice started.

## Product behavior

Access Availability belongs to each placement: ALL, MEMBERS, or PAY_ON_DEMAND. New placement creation requires an explicit policy. Existing legacy records retain their established access path until explicitly configured; no bulk conversion or permissive default was applied.

Authorized staff may edit a same-business-owned resource's placement policy without changing canonical identity, ownership, source or other placements. External ownership makes policy read-only to target-business staff. Existing local organization authority is preserved. Missing/hidden ownership fails closed. Owner-approved access bounds remain deferred.

The browser presents canonical server decisions; it does not inspect memberships or decide eligibility:

| Server outcome | Experience |
| --- | --- |
| public_access / qualifying_membership | Ready to watch through existing protected playback |
| authentication_required | Sign in to check access |
| membership_required | Available to eligible members; no player |
| membership_not_current | Access not currently active; no player |
| paid_access_required | Paid access required; purchasing unavailable; no checkout |
| placement_unavailable | No longer available here |
| resource_unavailable / access_policy_invalid | Currently unavailable |
| pending / unknown / failure | Neutral pending or unavailable; no optimistic player |

Published active restricted placements expose only approved metadata and safe outcomes. Hidden, withdrawn and unpublished content remains unavailable under lifecycle rules. Mixed libraries retain each item's own access state. Semantic status text accompanies restrictions. The reusable presentation accepts future contextual actions without implementing commerce or duplicating authorization.

## Verification

- Targeted: **63/63**. Tracked full regression: **1,151/1,151**. Logs: `l6-s3-targeted.txt`, `l6-s3-regression.txt`.
- Database proof under the actual restricted runtime: public/restricted/paid discovery, hidden denial, same-business editing, external editing denial, existing external policy preservation, unchanged canonical resource. Transaction rolled back.
- Hosted runtime proof: actual public/current-member/zero-current-credit playback bytes; exact membership expiry denial; paid denial; safe anonymous metadata; unpublished/withdrawn denial; legacy playback URL bypass denial; non-consumption. Fixture changes rolled back.
- Willow proof: rolled-back real database material, then deployed canonical resolver and presentation evaluation, with actual restricted-runtime relationship lookup. Wrong-business membership returned `membership_required`; withdrawal returned `placement_unavailable`; independent ALL placement retained `public_access`. This is **not a new live Willow browser playback proof**. Existing closed S2 hosted continuity evidence remains preserved.
- Browser: anonymous ALL video played; MEMBERS displayed sign-in; non-qualified admin saw locked details without a video element; authorized staff changed the temporary policy to Pay on Demand; paid state had no purchase action/player; withdrawal showed unavailable.
- Final candidate browser: Joe's existing current membership played the six-second MEMBERS video to completion (`currentTime=6`, `duration=6`, `readyState=4`, no media error). Admin saw the same safe metadata with membership-required status and zero video elements.
- External-owner server/database restrictions and read-only UI model are covered. No new externally owned playable asset was introduced for browser playback testing.

## Deployment and database

- Runtime: `aa88a34e396f2f3f686765e5b1b7c764e79f0533`, pushed to `product/layer3-public-entry`.
- Development Render deployment: `dep-db3c0n6i0phs739hiphg`, succeeded in 46 seconds. Service configuration/branch settings unchanged.
- Migration: `20261007212928_l6_s3_access_availability`, source `db/proposals/l6-s3-access-availability.sql`.
- No new roles or broad schema grants. PUBLIC, anon and authenticated cannot directly execute private media functions. Existing trusted runtime grants retained; validator grant is runtime-only. Trigger authority remains server/database enforced.
- No new security-advisor findings. Pre-existing unrelated search-path/password-protection advisories were not changed.

## Preservation and cleanup

Temporary browser placement `52a74e62-8ea0-4a75-a4ab-0e5dd2af9a33` and only its test audit rows were removed immediately after proof. Cleanup watchdog also armed. No new member/staff identity or persistent Willow link was created. SQL/runtime fixtures used rollback.

Before/after values match:

| State | Preserved value |
| --- | --- |
| Vega revision / state MD5 | 189 / ec6a3cbc4a395bc350244c228ec85cac |
| Willow revision / state MD5 | 0 / 1e8a823a955d74251b2a56b2cff77cfd |
| Member relationships MD5 | 2751a1e191d9fa327e62f7fee3adf94e |
| Canonical resources MD5 | 465491decf99982e63d25ef67d5cb67b |
| Placements MD5 | e40286fb77e8b5a5abde6eaf114e5940 |
| Placement audit MD5 | 93a4ec841034b6b644c0c79529f602b3 |

These comparisons cover business records, including booking, entitlement, commerce and communication state; they do not claim database sequences stayed unchanged during rolled-back tests.

## Evidence and changes

Screenshots are in `C:/Users/Joe Graham/.codex/visualizations/2026/10/06/01a11304-bc9a-7041-9580-543fd3a47718/`: `l6-s3-public.png`, `l6-s3-sign-in.png`, `l6-s3-locked-final.png`, `l6-s3-paid-locked.png`, `l6-s3-unavailable.png`, `l6-s3-current-member.png`, `l6-s3-deployment.png`.

Changed surfaces: `public/media-access.js`, `media-ui.js`, `watch.html`, `watch.js`, `app.js`; placement policy/service, viewer resolver/store, new access-management service, existing API/database/web adapters; bounded migration; three focused test files and three verification scripts. Full file list is available in `git diff --name-only 789c309..aa88a34`.

## Preserved boundaries / deferrals

Viewing remains non-consumptive. Current membership qualification, zero-credit qualification, OR semantics and business scoping are unchanged. Public/free access remains immediate where published. No owner viewer bypass, class-pack/drop-in policy, purchase entitlement, checkout, pricing, seller routing, payout, CDN/provider change, ads, bumpers, global feed or new rights hierarchy was introduced. Components contain no Vega- or PDX.Dance-specific authorization architecture.

No payment, email, SMS, payout, source-provider mutation or Production execution occurred. Layer 5 and closed L6-S1A/S1B/S2 remain intact. Production untouched.
