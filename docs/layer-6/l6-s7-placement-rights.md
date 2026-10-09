# L6-S7 — Owner Rights & Placement Delegation

Placement ownership is unchanged. Optional `rights` on the existing placement document records `present`, `organize`, and `access`. Only the verified canonical owner (personal owner or authorized manager of the owning business) can change this grant. Target staff require the existing `customers.manage` permission and the current grant. Revision checks and row locks serialize edits and revocation.

Access editing has four choices:

- `none`: no receiver policy changes.
- `restrict`: same or narrower policy relative to both the current policy and the owner snapshot (`ceiling`). ALL may narrow to either existing restricted mode. MEMBERS may remove qualifying membership products, never add them. MEMBERS and PAY_ON_DEMAND are not ordered against each other.
- `modes`: owner explicitly authorizes choosing policies in the selected modes, including membership audiences within MEMBERS. This is an explicit broadening grant, not an inferred one.
- `all`: owner explicitly permits all three supported modes.

Saving owner rights records the current policy as the ceiling. An owner policy edit updates the ceiling. Neither change transfers ownership, grants a business role, or changes another placement. Revoking presentation hides this placement atomically; restoring presentation does not automatically publish it. Withdrawal remains owner-controlled and final for this V1 workflow; retained grants become inert.

Legacy documents without rights preserve presentation and local organization. External-owner access editing defaults to denied. Existing same-business ownership continues to authorize that business's own policy edits. No existing documents are rewritten by the SQL proposal.

The server supplies permitted controls/options to Manage media. Receiver projections omit canonical source details and owner management controls. Fresh requests always recheck delegation; focus refresh and post-error refresh update stale UI. An already-open page can briefly show stale controls, but those controls cannot bypass server authorization.

Database changes: additive JSON constraints, audit details column, expanded audit actions, and replacement guards/owner policy helpers in the existing private schema. No new tables, browser grants, security-definer write APIs, or changes to viewer authorization semantics. Audit records include resulting policy and rights at the recorded revision.

Verification so far: 21 targeted service/management tests; 1,182 tracked regression tests passed. PostgreSQL trigger checks passed in a rolled-back fixture. Connector cannot assume `vega_app_runtime`; the private runner verifies that role separately before deployment. Security advisor before/after has the same four unrelated existing warnings.

Completed: restricted-runtime allow/deny and direct database denial proof; Development deployment; separate owner/receiver browser grant, permitted edit, and revocation; fixture cleanup; baseline and canonical-resource/binding hash comparison. Wording-only final runtime ac46eaf is live and browser-verified. Browser deliberately exposes no forbidden edit action; rejected edit attempts were verified through the restricted runtime service and database. No provider calls, uploads, player changes, commerce, ads, ownership transfer, or Production work.
