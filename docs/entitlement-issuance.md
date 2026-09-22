# Development product entitlements

The existing locked application aggregate now contains immutable entitlement products, issuance records, and fixed-period membership records. No schema, service, worker, credentials, permissions, or payment integration changed.

Supported products: one-credit drop-in, configured multi-class pack, fixed-duration membership with a configured per-period credit allowance, and courtesy/promotional grants. Product-backed purchases are explicitly simulated; they are not payment receipts. Manual courtesy issuance remains staff-only and carries source, actor, reason and command request identifier.

Product definitions snapshot quantity, validity days, category restrictions and class-ID restrictions. When both restriction lists are supplied both must match. Product-backed grants use a studio-wide issuance reference: retrying the same reference and intent returns the existing grant; conflicting reuse fails. Membership reference is bound to one participant/product; a period cannot be issued twice under another purchase reference. Later periods must begin at the previous period end. Each period grants fresh credits; previous credits expire without rollover. No automatic renewal or billing is implied.

Every issued unit and pass carries product/issuance/membership provenance, source, start and expiry, and restriction snapshots. Eligible units must be valid at both booking time and class start, with an exclusive expiry boundary. The earliest-expiring eligible unit is selected first. Existing untagged credits keep their original unrestricted terms. Waitlist promotion uses the same eligibility check. Cancellation restores the consumed unit's terms and provenance without extending expiration; reversal remains specific to the restored unit.

Staff define and provision on People. Members view their own passes and terms on Passes & membership. Unspent counts are not promises of eligibility. Issuance references, reasons and actor audit are staff-only. No member provisioning or checkout route was added.

Local verification covers product quantities, reference conflict/replay, membership period duplication/overlap/account binding, eligibility selection, rejection of ineligible credits, expiration, restoration provenance, staff-only issuance and member filtering. Hosted verification remains pending the matching development web deployment and Preview tests.
