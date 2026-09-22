# Development cancellation operations

The existing application-state transaction now records individual issued credits, booking consumption, cancellation restoration, and restoration reversal. No schema, role, credential, service, or billing subsystem was added.

Each class has a configurable cancellation cutoff (default 90 minutes). Cancellation exactly at the cutoff is early. Credit consumption applies only to classes explicitly configured to require a credit; existing classes retain their behavior. Waitlisted entries consume on promotion, not on joining the waitlist.

Early cancellation restores a consumed credit once. Late cancellation retains consumption. Staff can correct either classification with a reason. Early-to-late correction reverses only the originating booking's restored unit. If it was spent, the correction returns an explicit blocked outcome and commits the attempted correction history without changing credits. An unrelated available credit cannot substitute. Reinstating an unspent reversed restoration reuses the same unit.

Original cancellation classification, time, cutoff, class start, and booking status remain recorded. Subsequent staff actions append history; staff identity, reasons, and blocked attempts stay staff-only. Member command responses use the same history filtering as member reads.

The existing aggregate row lock serializes commands. Actor-scoped request identifiers replay saved results; altered payloads with reused identifiers fail. Credit effects and command receipts commit together.

Local validation covers cutoff equality, late cancellation, restoration and reversal cycles, spent-restoration blocking, unrelated-credit isolation, duplicate operations, command replay, committed blocked audit, permissions, and legacy no-credit bookings. Full suite: 52 passing tests; front-door static build and syntax checks pass.

Hosted verification remains pending deployment of this commit to the development web backend and Git Preview. Authentication verification remains closed. Production/bootstrap, Square, worker, and unrelated services are outside this change.
