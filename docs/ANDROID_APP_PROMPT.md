# Unico HomeCare: build prompt for the native Android app and the matching web restyle

Paste this whole file to the AI that will do the build. It assumes access to this repository, the Playwright MCP and Android Studio. Companion inventory: `docs/ANDROID_APP_AUDIT.md`.

## Status: server work already done (branch `android-app`, 2026-11-15)

Build the Kotlin app against these endpoints and do not rebuild them. Every call sends `Authorization: Bearer <token>`. The base address is `https://unico-homecare.vercel.app/api/v1` once this branch is deployed; until then, use a local server.

| Endpoint | What it gives the app |
|---|---|
| `POST /auth/login` with header `x-hc-native: 1`, body `{identifier, password, client: "app"}` | `token`, `expiresAt`, `user` |
| `POST /auth/refresh` | a new `token` and `expiresAt`; the old token stops working. Call it when fewer than 7 days remain |
| `POST /auth/logout` | revokes the bearer session and clears the phone's push token |
| `POST /devices` `{installId, model, osVersion, appVersion, appBuild, pushToken?}` · `GET /devices` · `DELETE /devices/:installId` | register this phone (call after sign-in, on every start and when the FCM token changes), list phones, remove one |
| `GET /app/config?build=N` | the user, `permissions`, `modules` (key, label, group, Material icon, badge), `tabs` (up to 4 keys; add "More" as the fifth), `badges`, `features`, `general`, `sla`, `whatsapp` link state, `enums` (statuses with colours and next steps, priorities, payment and transport modes, vitals…), `app` (update and maintenance state), `credit` |
| `GET /app/badges` | `unread`, `open`, `outbox`, `approvals`, `store` |
| `GET /app/home` | field "Today": `today`, `hero`, `awaiting`, `notes`, `unread`, `completed` |
| `GET /dashboard` (requests.readAll) | operations dashboard: KPIs, 14-day trend, metrics, live visits, escalations, mixes, maps budget |
| `GET /board?status&priority&service&zone&staff&date=today\|tomorrow\|week\|YYYY-MM-DD&q` | requests board rows and filter options |
| `GET /patients/board?q&zone&status&priority&staff&service&page` | patient board, 25 per page |
| `GET /search?q=` | requests and patients; `exact` is a request id to open straight away |
| `GET /requests/:id/extras?parts=counts,assignment,attachments,photos,notified,undo,kit,after` | the request-detail panels missing from `GET /requests/:id`, plus `people` names |

Module keys in `lib/app-modules.ts` are stable: map each key to a screen. Use `dashboard` for read-all users and `GET /app/home` for everyone else. Admins switch modules off per role in `settings.app.hiddenModules`, and set the update fields (`latestBuild`, `minBuild`, `apkAttachmentId`, `maintenance`, `apiBase`) in `settings.app`.

Permission fixes done: `GET /patients` also opens to read-all roles; transport documents can be saved with `transport.manage`; the WhatsApp link state reaches message senders through `app/config`; the Roles page text now says custom roles are enforced.

Still to do on the server: push sending (FCM) and the notification control centre, the WhatsApp host endpoints, Google sign-in from the app, the remaining read endpoints in section 4.2 (reports JSON, fleet availability, store loan figures, messages and audit filters, approval counts, maps usage, booking stats, staff sessions, visit report PDF, batch location pings, signed uploads), and the credit line on the web.


## 1. What you are building and why

Unico HomeCare is the home care system of Unico Hospitals, Family Medicine, Dhaka. Today it is one Next.js 16 app on Vercel: a web admin (`app/(admin)`), a phone web app for field staff (`app/m`), and a REST API (`app/api/v1`) on MongoDB Atlas.

Build two things that share one design:

1. **A native Android app in Kotlin** that lets every staff role do their whole job without the website: admin, coordinator, front desk, viewer, doctor, nurse, allied staff, driver, car supervisor.
2. **A restyle of the existing web admin and field web app** so they look the same as the Android app.

Patients are out of scope and keep the website (booking page, tracking link, portal).

The users are hospital staff in Dhaka on mid-range Android phones and mobile data, sometimes with a weak signal inside a patient's home. Coordinators handle many requests an hour and need speed; field staff need large targets and few steps. Judge every screen by whether such a person can finish the task quickly without training.

Read first: `CLAUDE.md`, `AGENTS.md`, `docs/ANDROID_APP_AUDIT.md` (inventory of modules, endpoints and gaps) and the spec `ui/design/uploads/UNICO_HOME_CARE_MODULE_PLAN.md`. The audit is a snapshot and another tool edits this repo concurrently, so confirm each endpoint and file in the code before you depend on it.

## 2. Ground rules (each has a reason)

- **The website keeps working.** Server changes are additive; the web restyle changes appearance, not behaviour. Patients and public pages rely on the site, and staff move over gradually.
- **`main` deploys to production within a minute.** Work on a branch, run `npm run typecheck` before any push, and ask the owner before merging or pushing to `main`. Commit with explicit paths because another tool stages files in the same repo.
- **The local `.env.local` database holds real staff and patients.** Never run `npm run seed -- --reset` against it. Ask the owner for a test login or a separate test database.
- **H360 (hospital HIS) is strictly read-only.** Only search and view; POSTs go through `readOnlyPost()` in `lib/h360-items.ts`.
- **Every mutation calls `audit()`**, input is validated with zod, route files export only HTTP handlers, permissions are checked on the server with `can(role, perm)`, and field staff only see requests where they are on the team (`canView`).
- **Next.js 16 differs from older versions.** Read the relevant guide in `node_modules/next/dist/docs/` before writing server code.
- **English only** on every staff screen.
- **WhatsApp rules that must survive:** the request number (HC-YYMMDD-NNNN) never appears in a WhatsApp text (`stripRequestNo()`); every WhatsApp caused by a person's tap first asks who gets it (the notify picker, `notify: string[]` on the action body); every automatic WhatsApp waits in the Outbox as PENDING until an admin with `messages.approve` sends it (never pass `approved: true` for real messages); the vehicle requisition goes out only after staff are assigned.
- **No paid server and no direct database access from the phone.** Everything goes through `/api/v1` on Vercel, which keeps cost at zero and keeps permissions and audit in one place.
- **No web address and no web pages in the app.** Do not use a WebView, do not show the server address anywhere, and do not send the user to the website for any task. Reports, PDFs, help and every admin function are native screens. The server address lives only in the build configuration: `https://unico-homecare.vercel.app/api/v1`, the stable production domain. Never use a per-deployment address (`unico-homecare-<hash>-unico-family-medicine.vercel.app`); it is frozen to one deployment and stops receiving updates. Let `app/config` return a replacement base address, so a later move to a hospital domain does not strand installed apps. When staff share a patient link (booking, tracking, feedback) the app offers Share and Copy buttons rather than printing the address. Phone dialler, WhatsApp and Google Maps intents are fine.
- **Never commit** the release keystore, Firebase service-account keys or any `.env` value. The `android/` folder must be excluded from the Next build, typecheck, lint and Vercel upload.

## 3. Architecture

**Android app** in `android/`: Kotlin, Jetpack Compose, Material 3 as the base, single-activity with Navigation Compose, coroutines and Flow, a dependency-injection library, an HTTP client with kotlinx.serialization, Room for the cache and the offline queue, WorkManager for background sync, encrypted storage backed by the Android Keystore for tokens, Coil for images, Google Maps Compose, Firebase Cloud Messaging, CameraX and ML Kit (document scanner, text recognition). Gradle Kotlin DSL with a version catalog. Use current stable versions and check their docs. Minimum Android 8; the WhatsApp host phone needs Android 10 or newer.

**"Fully dynamic":** the app holds no role logic of its own. On launch and on resume it calls a new `GET /api/v1/app/config`, which returns the user, effective permissions (custom roles included), the modules and tabs this user may see, feature toggles, the enums and status transitions from `lib/constants.ts`, the settings the client needs, notification alert styles, the latest and minimum app versions and a maintenance message. Navigation, buttons and forms are drawn from that. Master lists (services, zones, departments, designations, vehicles, equipment, templates, tests) are always fetched. An admin changing a role, a toggle, a service or a rule changes the app for everyone on their next refresh, with no new APK.

**App updates:** an in-app updater compares versions from `app/config`, downloads the signed APK through the API and starts the install. Play Store comes later.

**Keeping two clients in step:** export JSON Schema from the zod schemas and test the Kotlin models against it, so an API change that breaks the app fails a test instead of a phone.

**Server (same Next app):** thin new read routes that wrap the service functions the web pages already call. Do not duplicate logic.

**WhatsApp host (inside the app, on one hospital phone):** an admin opens Settings → WhatsApp on the dedicated phone and turns on "Use this phone as the WhatsApp host". That phone then keeps the WhatsApp connection open all day in a foreground service and acts as the transport. The Vercel server stays the brain.

- **The server decides, the phone delivers.** The queue, the approval Outbox, templates, `stripRequestNo()` and every safety rule in `lib/wa/guard.ts` (caps, warm-up, pacing, quiet hours, dedupe, staleness, opt-out, circuit breaker) stay on the server. The host asks "what may I send now?", sends it and reports the result.
- **Host endpoints to add under `/api/v1/wa/host`:** claim and release (one host at a time, needs the settings permission), heartbeat every 30 s (state, battery, charging, network), next (messages cleared to send, with media links and pacing delay), result (sent or failed with the WhatsApp id and error), events (incoming messages, ticks, reactions, deletions, group names, typing and online state), number-check, and tick. Reuse `lib/wa/inbound.ts`, `receipts.ts` and `ticks.ts` to store what the host reports, and de-duplicate by WhatsApp message id.
- **Waking the host.** When a message becomes QUEUED or an admin asks for a check, the server sends a high-priority FCM data message to the host; the host also polls every 15 to 20 s as a backstop.
- **The host is its own linked device.** It pairs separately and keeps its WhatsApp credentials encrypted on the phone; they never go to the server. The existing Vercel session stays paired as the fallback and does a short daily check to stay valid.
- **Fallback.** While the host heartbeat is fresh, the Vercel paths (`pumpWhatsApp`, `syncInbox`) stand down. If it is older than about 90 seconds they resume today's connect-on-demand behaviour and admins get a push saying the host phone is offline.
- **Minute tick.** The host calls tick every minute, which runs `sweep()` and `reminders()` on the server, so timeouts and overdue alerts no longer depend on someone opening a web page. The Vercel project is on the Hobby plan, where cron runs at most once a day, so this tick is the only scheduled timer; when the host is offline, timers fall back to running whenever any app or web screen loads a board, as today. Keep every new route within Hobby limits (function duration, 4.5 MB request body).
- **Live updates for other phones.** There is no socket server. Other apps learn of changes through FCM data messages that trigger a refetch, plus polling (3 to 5 s in an open chat, 15 to 30 s on lists).
- **Keeping the host alive.** A setup checklist on that phone: battery optimisation off, auto-start allowed, app locked in recents, start on boot, charger and Wi-Fi with mobile data as backup. Show host health (online, battery, last message) in Settings on every admin's phone.

**Prove the host first.** Before building any WhatsApp screen, run a proof of concept on the real host phone: pair, send, receive a text and a photo, survive a locked screen, and stay connected for 24 hours. Try in this order and stop at the first that passes:
1. A WhatsApp multi-device library compiled into the app as a native library (for example whatsmeow, written in Go, bound to Kotlin with gomobile). No Node runtime is needed.
2. Node embedded in the app running Baileys. Check the embedded Node version against Baileys' requirement (Baileys 7 needs Node 20 or newer).
3. The host script under Termux on that phone, started on boot and controlled by the app over localhost.

All three use the same `/wa/host` contract, so the rest of the system does not care which one runs. If none passes, stop and tell the owner; do not quietly switch to a paid server.

## 4. Server work

### 4.1 Auth and devices
- `POST /auth/logout` revokes the bearer session too.
- `POST /auth/refresh` rotates the token (short access token plus a refresh token bound to the device).
- `Device` model and `POST/DELETE /devices`: push token, model, OS version, app version, last seen. Show devices in the profile and to admins on the staff screen, with remote sign-out.
- `POST /auth/google/native {idToken}`: verify the Google signature properly, then issue a session. The same for the sign-up flow that today needs the `hc_signup` cookie.
- The app logs in with `client: 'app'`. Give VIEWER app access by default and make sure every role that could use the web can use the app.
- A real forgot-password path: request a reset; an admin approves it or a temporary PIN goes out on WhatsApp through the existing `POST /users/:id/app-login`.

### 4.2 Read endpoints to add (each wraps an existing function)

| Need | Existing function |
|---|---|
| Dashboard KPIs, charts, escalations | `dashboardData()` in `lib/services/dashboard.ts`, `googleBudget()` |
| Board rows with `today / tomorrow / week` ranges | `boardRows()` |
| Patient board with all filters and paging | `loadPatientBoard()` in `components/people/patient-board.ts` |
| Global search (requests and patients, exact number jump) | logic in `app/(admin)/search/page.tsx` |
| Badge counts (open requests, store low stock, overdue loans, pending approvals) | queries in `app/(admin)/layout.tsx` |
| Request detail extras: assignment log, attachment list, Notified timeline, undo preview, bag rows, after-return rows | `AssignmentLog`, `notifyTimeline()`, `revertPreview()`, `kitRows()`, `afterRows()` |
| Visit report and prescription as JSON and as a PDF | data behind `app/print/report/[id]` (build the PDF with pdf-lib as `lib/forms/*` does) |
| Staff list extras (active sessions, last seen) | Session aggregate in `app/(admin)/staff/page.tsx` |
| Services, consumables and staff reports as JSON | `lib/services/reports-more.ts` |
| Fleet availability, trips today, car picker data | `components/transport/data.ts` |
| Store item figures (lent out, borrowed), tab counts | `loansByItem()`, `store:lastCompare` |
| Messages log: template and date filters, template list, email KPIs | queries in `app/(admin)/messages/page.tsx` |
| Audit: client filter and filter option lists | queries in `app/(admin)/audit/page.tsx` |
| Approvals: pending count per type; a staff member's own change requests | `listApprovals()` |
| Maps usage report, booking link stats, resolved alert groups, coordinator on duty, profile stats | `usageReport()`, `bookingLink()`, `hodConfig()` |
| Location pings in a batch (points saved while offline) | `recordPing()` |
| Signed upload for files over 4 MB; APK download for the updater | storage helpers in `lib/files.ts`, `lib/storage.ts` |

Move any query that lives inside a page file into a service function first, then call it from both the page and the route.

### 4.3 Permission mismatches to fix
1. `GET /patients` needs `requests.create`, which blocks VIEWER from the Patients screens.
2. `GET /settings/whatsapp` needs `canOpenSettings`, so FRONT_DESK cannot see whether WhatsApp is paired.
3. Saving transport documents needs `canOpenSettings`, so the car supervisor can open Fleet but not save it.
4. Service types and zones open with `requests.manage` but saving needs `master.manage`.
5. The Roles screen says custom roles are not enforced, yet `can()` honours `user.permissions`. Make the text match the behaviour.

`route()` never checks the token audience or `platformAccess`; decide deliberately whether the API should, and apply it consistently.

## 5. Modules the app must cover

Port every item. The audit file lists each screen's data, actions and endpoints.

**Operations:** Dashboard · Requests board (swipeable status columns with long-press drag, and a list view; filters; bulk delete; CSV) · New request (patient search local and H360, address block with GPS and pin, services and H360 tests, slot picker, team, fee, notify picker, save / save and confirm / save and assign) · Request detail with all tabs (overview, timeline, assignment, visit, invoice, messages, attachments, audit, notified) and every action (verify, confirm, assign and reassign, reschedule, cancel, undo last step, close and invoice, act for the team, complete now, car and driver, own transport and petty cash, car times, transport documents, rides, live tracking, visit update, bag, consumables, after-return checklist, bills including H360 import, payment, rebill, send bill, compose message, delete) · Live map · Global search.

**People:** Patients board and profile (H360 refresh, documents, notes, labs, care plans, balance) · Staff (add, edit, suspend, reset password, sign out everywhere, app login PIN, CSV import, sign-up link, devices) · Approvals · Claims.

**Field work:** Home, visits, visit detail and every step (bag, start journey, check-in with GPS, checklist, vitals, notes with dictation, medication, photos, consumables, prescription and labs, patient confirmation by signature, OTP or verbal, check-out, reached hospital, change request, internal chat, directions) · Care plans · Notes and handovers · Day route · My claims · Driver trips and vehicle · Car supervisor trips, assign car and fleet.

**Communication:** WhatsApp (section 7) · Messages log and broadcast · Notifications · Templates with versions, preview and test.

**Store:** items and stock, receive, consume, loans, H360 match, consumption, movements, images.

**Reports and control:** Reports (overview plus services, consumables, staff; CSV; print) · Audit log with diff · Settings in full: general, SLA and slots, zones, service types, designations and departments, roles and custom roles, fleet and transport documents, online booking, Gmail, H360 logins, WhatsApp connection, host and safety, feature toggles, scheduled jobs, maps and API usage, notification control (section 6), app control (module visibility per role, minimum version, maintenance message), About · My account (photo, signature, password, sessions, devices, preferences).

Browser features need native replacements: CSV and PDF via download plus the Android share sheet; an in-app PDF viewer; printing through the Android print service; CSV import via the document picker; document scanning and bill reading with ML Kit; signature pad; speech dictation; clipboard; dialler, WhatsApp and Google Maps intents; Google Maps for maps (check current Maps SDK pricing and keep reporting geocoding and Places calls to the existing maps budget).

**Background GPS** is the main reason for going native. Use a foreground location service that keeps sending while the phone is locked or another app is open, with the web cadence (a point every 5 s when moved 15 m, a heartbeat every 20 s), points saved offline and sent in a batch later, a clear explanation screen before asking for "Allow all the time", and a prompt to exempt the app from battery optimisation. Keep the address GPS accuracy rule from `components/client/AddressBlock.tsx`.

**Offline:** queue en-route, check-in, checklist ticks, vitals, notes, medication and photos with `deviceAt` and `offline` stamps, as `components/field/live.tsx` does, and show what is pending.

## 6. Push notifications and the admin control centre

Send through Firebase Cloud Messaging from the server. Hook into `notifyUsers()` in `lib/messaging.ts`, so every existing in-app notification can also be a push, logged in `MessageLog` (channel PUSH) with its delivery status. Add a native screen target to each notification's data; today `data.url` holds web paths.

Build a **Notification control** screen (app and web) where an admin sets everything without a developer:

- **Triggers.** A catalogue of events: the existing `ALERT_EVENTS` and `notificationRules` events, plus incoming WhatsApp, message waiting for approval, WhatsApp failed or paused, host phone offline, internal chat message, approval pending, claim submitted, petty cash request, store low stock, loan overdue, tracking lost, abnormal vitals flag, SLA breach. Timer triggers too: not confirmed after N minutes, not assigned after N, not accepted after N, visit late by N.
- **Conditions.** Service, priority, zone, time of day.
- **Recipients.** By role, by person, the care team, the request creator, the driver, alert groups.
- **Channels.** Push, in-app, WhatsApp, email, per rule.
- **Alert style.** Silent, Normal, High (heads-up), Alarm (keeps sounding until opened). Android locks a channel's sound and importance once created, so map the styles to a fixed set of notification channels created at first launch, and let the admin choose the style per rule.
- **Repeat and escalate.** Re-alert every N minutes up to M times while unread; if still unread after X minutes, notify another role.
- **Quiet hours**, with a per-rule override for urgent events.
- **Test push** to any user or device, **broadcast** to roles or people, and a **delivery log** (sent, delivered, opened, failed, per device).
- Whether each staff member may adjust their own preferences, and which rules are locked (the assigned-to-staff rule cannot be turned off today; keep that).

Notifications are grouped by type, offer actions where safe (Accept visit, Open, Reply), and tapping one opens the exact screen.

## 7. WhatsApp inside the app

Carry over everything that exists (see the audit list): chat list with filters and search, threads with ticks and message info, the approval Outbox, the "Review and send" dock tied to the tap that created the messages (`x-wa-batch` header on every mutation), edit before send, send all, discard, retry, send now, the notify picker and preview, the Notified tab, pairing, connection state, queue drawer, safety meters and limits, pause and resume, templates.

Add, using the host phone:
- Live arrival of messages, typing and online state, with a push per chat and a reply action from the notification.
- Sending photos (camera or gallery), documents, voice notes (record as OGG/Opus on the device, which Android 10 and newer support), location and contacts; playing incoming voice and video; a media gallery per chat.
- Reply to a specific message, react, forward, delete for everyone, search inside a chat.
- Start a chat with any number, patient or staff member.
- Quick replies and template insert with variables filled from the linked visit.
- Link a chat to a patient or request, and create a request from a chat.
- Pin, mute and archive chats; an unread badge on the tab.
- Files larger than the 4 MB API limit, sent or received, go straight to storage through a signed upload issued by the API.
- A "WhatsApp host" screen: turn hosting on or off for this phone, pair, health, setup checklist, move hosting to another phone.

Pairing: the hospital WhatsApp may be on the same phone as the app, where a QR code cannot be scanned. Make "Link with phone number" (the 8-character code) the first option and the QR the second.

Say plainly in the UI what cannot be done: WhatsApp voice and video **calls** are not available through this connection, so the Call button opens the phone dialler or the WhatsApp app. Status updates stay out. Free-typed replies still pass the safety pacing. Keep "send read receipts" off unless an admin turns it on.

## 8. One design for Android and web

Keep the brand: primary `#0090CA`, teal `#3AB5A7`, navy `#1F3864`, DM Sans, and the existing status colours.

**One source of truth.** Write the design tokens once (`design/tokens.json`: colours, glass fills, blur, borders, radii, spacing, type scale, shadows, motion, light and dark) and generate both the Tailwind theme in `app/globals.css` and the Kotlin theme from it. Write `docs/DESIGN_SYSTEM.md` naming each component (glass card, button, input, chip, sheet, list row, status chip, SLA pill, timeline, chat bubble, tab bar, top bar) with its states, so the Compose and the web versions are built to the same description.

**The glass style:**
- A soft, slowly moving gradient of the brand colours behind every screen; light and dark themes following the system, with a manual switch.
- Translucent surfaces with background blur, a fine light border, soft shadow, 20 to 28 px corners. On Android use real blur on the chrome only (floating tab bar, top bar, bottom sheets, main action button, hero cards) and pre-tinted translucent cards inside long lists, because blur on every row drops frames on mid-range phones. Blur needs Android 12; older phones get the tinted fallback.
- Readability first: body text keeps at least 4.5:1 contrast on its surface; inputs and dense tables sit on near-solid fills; a "reduce transparency" setting turns glass into solid cards.

**Android layout and ease of use:** native Material behaviour throughout (system back, edge-to-edge, predictive back, ripple, haptics). A floating pill tab bar with four or five tabs chosen by role and a "More" grid of every module the user may open. Bottom sheets instead of drawers. Tables become cards with a sort and filter sheet. On tablets (600 dp and wider) a list and detail side by side. One primary action per screen anchored at the bottom, targets at least 48 dp, swipe actions on rows, pull to refresh, skeletons while loading, an undo bar after destructive actions, remembered filters, recent items, a quick-action button per role, helpful empty states, fingerprint unlock, large-font support, short spring animations that respect the system "remove animations" setting.

**Web restyle:** restyle, do not rewrite. Change the tokens in `app/globals.css` and the shared primitives (`components/ui`, `components/admin` Sidebar and AdminPage, `components/mobile`, and the Drawer, Sheet and form controls in `components/client`), then pass through each page to fix what the primitives did not reach. At phone width the web field app and the Android app should be hard to tell apart; on desktop the web admin is the wide layout of the same system, with its sidebar and real tables. Do not restyle the public booking page. Take layout, copy and information order from the existing screens and the mockups in `ui/design/*.dc.html`; the workflow stays as it is.

**Credit line.** Show "Design and developed by Nasif Ahammed Niloy (nasifahammedniloy.com)" in small text, with the site name opening in the browser: at the bottom of the sign-in screens (Android, web `/login`, `/m/login`), in About inside Settings (Android and web), and in the footer of every staff page (web admin page footer and web sidebar bottom; bottom of the Android "More" menu). Not on the public booking page or patient portal.

## 9. Checking the UI

**Web, with the Playwright MCP** (`mcp__plugin_playwright_playwright__browser_*`):
1. Before restyling, sign in with the test login and screenshot every admin page and every `/m` page, including drawers and tabs, into `docs/qa/before/`. This is the feature baseline.
2. After restyling, open every page again at 1440×900 and 390×844, light and dark. Check for clipped or overlapping content, contrast, tap-target size, console errors and failed requests; save to `docs/qa/web/`. Fix and re-check.
3. Drive the main journeys end to end against the test database: create, confirm, assign, accept, journey, check-in, visit steps, check-out, close; approve a WhatsApp message.

**Android.** Playwright cannot drive a Kotlin app, so:
1. Add screenshot tests that render every Compose screen to PNG on the JVM (light, dark, phone, tablet) and read the images to judge them, saving to `docs/qa/android/`.
2. Compare each Android phone screenshot with the web 390-wide screenshot of the same screen; they should match in structure, colour and spacing.
3. Run on an emulator and a real phone and capture with `adb` for what screenshots on the JVM cannot show: blur, maps, camera, background GPS with the screen locked, push, the WhatsApp host.

Keep `docs/PARITY.md`: one row per web feature with the Android screen, status and both screenshots. The work is complete when no row is open.

## 10. Phases

Finish and verify each before the next. Report what was verified, what failed and what was skipped.

0. **Foundations and proofs:** native auth, devices, `app/config`, read endpoints, permission fixes, baseline screenshots, the WhatsApp host proof of concept.
1. **Design system on both sides:** tokens, components in Compose and on web, sign-in screens, credit line, the web restyle of shared primitives.
2. **App shell:** config-driven navigation, dashboard, notifications list, account, search, updater.
3. **Operations:** requests board, new request, request detail with all tabs and actions, patients, staff, approvals, claims, live map.
4. **Field work:** visit flow, background GPS, offline queue, chat, care plans, notes, route, claims, driver and car supervisor screens.
5. **Push and notification control** (app and web).
6. **WhatsApp:** host mode and endpoints, live inbox, review dock, pairing, safety, media, voice.
7. **Store, reports, messages log, audit, all settings, app control.**
8. **Finish:** page-by-page web restyle pass, tablet layout, accessibility, performance on a mid-range phone, signed APK, parity sign-off.

## 11. What the owner must provide

- A test login or a separate test database.
- A Firebase project (free): `google-services.json` for the app and a service-account key for the server.
- A Google Maps key for Android, restricted to the app's package and signing certificate.
- One Android phone (Android 10 or newer) dedicated as the WhatsApp host, kept on charge and Wi-Fi, plus a second phone for testing.
- Android Studio with the SDK and an emulator on the build computer.
- A decision on where the release keystore is kept.

## 12. Done means

Every row in `docs/PARITY.md` is closed; a person in each role completes their daily work in the app alone, without seeing a web address; the web admin and the app look the same; WhatsApp replies arrive live through the host phone, WhatsApp keeps working the old way when that phone is off, and every existing WhatsApp rule still holds; an admin can create, change and test a notification rule and see its delivery log; location keeps flowing with the screen locked; the credit line shows in the agreed places; `npm run typecheck` passes and the website behaves as before.
