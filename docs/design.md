# Vega operational experience · 21 September 2026

Ray implementation record. Governing sources: `docs/consumer-network-architecture.md` Revision 7 (including the Vega / Studio scope at line 733), `docs/acrux-module-catalog.md`, and the existing Vega participation policy. Canonical Ray loaded from team revision `7367904f1a11c6de9c4a35e817d403393f4250ba`. Today's owner instruction authorizes ordinary experience decisions, functional wireframe construction and development deployment without new internal approval gates.

## Current artifact

`public/index.html`, `public/styles.css`, `public/app.js` provide the responsive operational application shell. This is an authored direction for today's build, not a claim of an earlier owner-approved Vega brand system. No existing Vega-specific design record or supplied brand assets were found. The restrained evergreen, warm paper and light chartreuse palette, editorial serif headings and practical compact controls prioritize everyday studio use. No externally hosted font, image or script dependency is introduced.

Member journeys: today, class search/filter/detail, explicit participant reservation, separate reservation/payment/attendance/notification outcomes, cancellation, passes/membership, video detail, events detail, example shop bag, participant profile, communication preference examples. Staff journeys: overview, class roster selection, check-in/undo, participant detail, communication drafts, worker exceptions/retry and CSV participation reporting.

Reservation, cancellation, attendance and worker retry bind to the parent's authenticated API. Browser sessions are held in memory, not persistent web storage. Authenticated role derives from the server; role switching is limited to explicitly synthetic demo mode. No browser worker execution or Square enablement control exists.

## Truth and simulation

The login screen provides a deliberate interactive-wireframe entry. Synthetic examples remain in the current browser tab and never call mutation APIs. The banner and footer mark provenance. Wider passes, media, events, merchandise and communications surfaces are labeled design examples until domain integrations are available; buttons expose details or modify local example state without claiming live orders, enrollment, consent or messages. Example video detail explicitly reports absent media. Membership and merchandise prices are not invented. No checkout or sender action is present. The wireframe's sample classes, people and schedules are invented, not operational data.

The live application path displays server records and submits server-authorized commands. Booking does not prove payment, pass use, attendance or message delivery. Network connection remains optional. Participant, payer and delegate authority are visibly separate.

## Responsive and accessibility behavior

Desktop uses a persistent studio sidebar; narrow screens use horizontally scrollable navigation and stacked cards/forms. Tables scroll within their card. Native dialog supplies modal keyboard behavior; forms use explicit labels, semantic buttons and native validation. Focus visibility, a skip link, status announcements and error feedback are provided. Navigation focuses the main surface. Search and empty states retain recovery paths.

## Review evidence and limits

Source implementation and both JavaScript modules pass syntax checks. CUA reported no available surfaces. A bundled Playwright/installed Edge headless fallback subsequently passed 10 journey checks against a fresh ephemeral localhost development server: member home; class search/reservation; staff check-in/undo; synthetic class creation; synthetic participant creation; all staff surfaces; cancellation; all member surfaces; 390px mobile layout without horizontal page overflow; and session exit. Desktop viewport was 1440×1050; mobile was 390×844. No page exceptions or application console errors occurred (expected unauthenticated resource responses are excluded). These are synthetic wireframe tests, not authenticated hosted API or provider-effect evidence.

Ray directly inspected `docs/screenshots/desktop-today.png` and `docs/screenshots/mobile-classes.png`. The tested compositions preserve hierarchy, readable controls and responsive navigation. A mobile search-width correction and CSP-compatible pass progress styling were applied, then the full check passed again. Machine-readable evidence: `docs/screenshots/verification.json`; reproducible script: `scripts/verify-ui.mjs`. No owner review, wider domain completion or Production approval is claimed. Functional wireframe fidelity is not evidence that illustrative modules have durable domain implementations.

## Application integration extension

`public/integration.js` adds staff class/participant creation, participant-scoped preference saving, persisted communication drafts and waitlist promotion. Authentication-derived roles cannot be switched. Initial member navigation is normalized to member routes. Leave workspace clears session and local example state. Mutation identifiers survive an ambiguous network retry for the same action payload. In authenticated state, passes, video, events and merchandise show honest unpublished/empty states; their sample offerings exist only in the explicitly chosen wireframe. Worker retry is hidden while that API remains unavailable. The server must serve the additional module at `/integration.js`.
