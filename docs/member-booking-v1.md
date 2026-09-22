# Section 3.1 — Member Booking Experience V1

The member schedule shows upcoming classes, instructor, location, time, capacity and the member's booking status. Opening a class refreshes the server state and explains eligibility for the selected authorized participant. Confirmation names the pass and one-credit requirement; no-credit classes say so explicitly. Confirmed bookings appear in upcoming activity and booking history. The existing cancellation UI and rules remain authoritative, with refreshed credit totals and cancellation outcomes.

## Architecture

`visibleState` adds participant-scoped `bookingOptions`. The read-only summary and transactional consumption share `eligibleCredits`, extracted without changing the verified entitlement predicate or ordering. The confirmation pins the disclosed pass. A stale pass fails rather than consuming a different pass. The locked application-state transaction rechecks capacity, duplicate booking, authority and entitlement validity; command replay remains atomic. Members cannot enter a waitlist through the booking command, including when capacity disappears after opening the class. Existing staff behavior is unchanged.

No new database, subsystem, payment integration or cancellation policy was needed. Request identity is retained until the post-mutation refresh succeeds, allowing a lost response or failed refresh to be retried without a second consumption. Authentication, issuance and cancellation rules, worker and temporary diagnostics remain in place.

## Local verification

- 64 Node tests passing, including shared selector agreement, expiration at class start, future validity, category/class restrictions, unavailable classes, full classes with waitlists configured, stale selected pass, duplicate booking, participant isolation and unchanged cancellation terms.
- Store-level booking replay and altered-payload rejection assert no second consumption or revision change. Existing cancellation replay/correction tests pass.
- Browser verification: pre-confirmation pass disclosure and participant selection, lost POST response retry with one consumption, booking reload, duplicate/full/ineligible disabled states, early cancellation repeat with one restoration, late cancellation with no restoration, and capacity lost after preflight.
- Desktop and 390px mobile schedule checked; no page errors or horizontal mobile overflow. Evidence: `member-booking-local/verification.json` and screenshots.
- Browser uses synthetic identities/state and actual domain transitions. It does not claim hosted database or authenticated Preview verification.

## Deployment boundary

Development Preview and the pinned Development web service only. Production/bootstrap, Square, worker and unrelated services must remain unchanged. Hosted verification is pending until the matching backend is live and member/staff sessions are available. Prior hosted fixture history must be retained.
