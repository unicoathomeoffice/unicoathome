# Unico HomeCare: system audit for the Android app

Snapshot taken 2026-11-15 at commit `6727203`. It inventories what the web admin, the field web app and the API do today, so the Android app (see `docs/ANDROID_APP_PROMPT.md`) can match it. Another tool edits this repo at the same time; confirm each item in the code before relying on it.

Legend for "Read API": **YES** an endpoint returns the data · **Partial** part of it · **NONE** only a server component reads it from Mongo.

## 1. Headline findings

1. **Every write already goes through `/api/v1`.** The admin has no server actions. 136 `route.ts` files.
2. **Reads are the gap.** Many pages query Mongo inside server components. Section 6 lists every missing read.
3. **Bearer auth exists but is incomplete.** `POST /auth/login` with header `x-hc-native: 1` returns `token`; `lib/auth.ts` reads `Authorization: Bearer`. Missing: bearer logout, refresh, device model, push tokens, native Google sign-in.
4. **No push.** Notifications are Mongo rows read by polling. `data.url` holds web paths.
5. **WhatsApp is two-way** but messages arrive only while a short Vercel session is open.
6. **Timers ride on page views.** `sweep()` runs when the dashboard, the board, `/tracking/live` or `/requests/:id/location` load (once a minute per instance). The Vercel cron runs once a day (Hobby plan).
7. **Browser GPS stops when the phone locks.** That is why the app is native.

## 2. Roles and permissions (`lib/constants.ts`)

Roles: SUPER_ADMIN (SA), HC_ADMIN (HCA, "Home Care Coordinator"), FRONT_DESK (FD), DOCTOR, NURSE, ALLIED, DRIVER, TRANSPORT_SUPERVISOR (TS, "Car supervisor"), VIEWER ("Management, read-only").

| Permission | Roles |
|---|---|
| users.manage, master.manage, settings.manage, requests.override | SA |
| users.read | SA, HCA, TS |
| templates.manage, requests.manage, requests.assign, requests.delete, messages.approve, store.manage, audit.view, approvals.decide | SA, HCA |
| requests.create, messages.send | SA, HCA, FD, DOCTOR, NURSE, ALLIED |
| requests.readAll | SA, HCA, FD, VIEWER |
| patients.edit, billing.invoice | SA, HCA, FD |
| visit.execute | DOCTOR, NURSE, ALLIED |
| transport.manage | SA, HCA, TS |
| transport.drive | DRIVER |
| reports.view | SA, HCA, VIEWER |

Derived: `canViewMessages` = readAll and (send or reports.view) · `canResendMessages` = readAll and send · `canOpenSettings` = settings.manage or templates.manage. Custom roles (`CustomRole`) replace the matrix through `user.permissions`, which `can()` honours.

Default platform access: SA, HCA, FD → web and app · VIEWER → web · field roles, DRIVER, TS → app. Pages enforce it (`requireWebUser`, `requireAppUser`); `route()` does not.

Statuses and transitions:

| From | To |
|---|---|
| NEW | VERIFIED, CONFIRMED, CANCELLED |
| VERIFIED | CONFIRMED, CANCELLED |
| CONFIRMED | ASSIGNED, RESCHEDULED, CANCELLED |
| ASSIGNED | ACCEPTED, CONFIRMED, ASSIGNED, RESCHEDULED, CANCELLED |
| ACCEPTED | EN_ROUTE, IN_PROGRESS, ASSIGNED, RESCHEDULED, CANCELLED |
| EN_ROUTE | IN_PROGRESS |
| IN_PROGRESS | COMPLETED |
| COMPLETED | CLOSED |
| RESCHEDULED | CONFIRMED, CANCELLED |

Board columns: new (NEW, VERIFIED) · confirmed (CONFIRMED, RESCHEDULED) · assigned (ASSIGNED, ACCEPTED) · progress (EN_ROUTE, IN_PROGRESS) · completed · closed (CLOSED, CANCELLED). Priorities ROUTINE, URGENT, EMERGENCY. SLA values live in `settings.sla`.

## 3. Web admin modules

Sidebar order (`components/admin/Sidebar.tsx`): Dashboard · Requests (open count) · Live map · Patients · Staff · Reports · Claims · Store (low stock + overdue loans) · Messages · WhatsApp (outbox count) · Notifications (unread) · Settings. Header: global search, New request, WhatsApp review dock, bell, avatar.

| Module | Route | Permission | Read API | Main writes |
|---|---|---|---|---|
| Dashboard | `/dashboard` | web user | **NONE** (`dashboardData`, `googleBudget`) | none |
| Requests board (kanban + table, CSV, bulk delete) | `/requests` | requests.readAll | Partial: `GET /requests` lacks today/tomorrow/week and board shaping (`boardRows`) | verify, confirm, cancel, `POST /requests/delete`, `POST /messages/whatsapp` |
| New request | `/requests/new` | requests.create | Partial: `/settings`, `/master/*`, `/public/availability`, `/patients/:id` | `POST /requests` (`then: confirm or assign`), `/requests/candidates`, `/notify/preview`, `/h360/patients`, `/h360/items` |
| Request detail | `/requests/[id]` | canView | Partial, see section 4 | 31 actions plus bills, rides, kit, consumables |
| Patients board | `/patients` | requests.readAll | **NONE** (`loadPatientBoard`); `GET /patients` is search only and needs requests.create | `POST /patients`, `PATCH /patients/:id`, CSV `/patients/export` |
| Patient profile | `/patients/[id]` | requests.readAll | YES `GET /patients/:id` + `/care-plans?patientId` | photo, H360 refresh, documents |
| Staff | `/staff` | users.read | Partial: `GET /users`; session counts NONE | `POST /users`, `PATCH /users/:id`, `/users/:id/app-login`, CSV import |
| Live map | `/live` | requests.readAll | YES `GET /tracking/live` | none |
| Claims | `/claims` | approvals.decide | YES `GET /claims?all=1` | decide, paid, resend |
| Store (items, loans, H360 match, consumption, movements) | `/store` | requests.manage or store.manage | Partial: items lack loan figures; other tabs YES | `/store/*`, `/equipment/:id/*`, `/master/equipment` |
| WhatsApp inbox | `/outbox` | messages.approve | YES `/whatsapp/chats`, `/whatsapp/chats/:to` | `/outbox`, reply, seen, sync |
| Messages log | `/messages` | canViewMessages | Partial: no template or range filter, no email KPIs | resend, broadcast |
| Notifications | `/notifications` | web user | YES (no per-tab counts) | mark read, mark all |
| Reports | `/reports` | reports.view | Overview YES `GET /reports`; services, consumables, staff CSV only | CSV, print |
| Audit | `/audit` | audit.view | Partial: no client filter or option lists | CSV |
| Search | `/search` | web user | via `/requests?q` + `/patients?q` | none |
| Account | `/account` | web user | YES `GET /users/me` | photo, signature, password, sessions, preferences |
| Settings hub | `/settings` | canOpenSettings | Partial: `/settings`, `/settings/gmail`, `/settings/whatsapp`, `/integrations/h360` | general, Gmail, H360 (SA), WhatsApp pairing (SSE) and safety, feature toggles, run jobs |
| Templates | `/settings/templates` | templates.manage | YES | publish version, on/off, preview, test |
| Designations and departments | `/settings/designations` | master.manage | YES | `/master/*` |
| Roles | `/settings/roles` | users.manage | Partial (per-role counts NONE) | `/roles` (SA) |
| Approvals | `/settings/approvals` | approvals.decide | YES (per-type counts NONE) | `PATCH /approvals/:id` |
| Zones, slots, SLA | `/settings/zones` | requests.manage | YES | `/master/zones`, `PATCH /settings` general, sla |
| Fleet and drivers | `/settings/fleet` | transport.manage | Partial (trips today NONE) | vehicles, link driver, transport docs |
| Online booking | `/settings/booking` | requests.manage | Partial (link stats NONE) | `PATCH /settings` booking |
| Notification rules | `/settings/notifications` | canOpenSettings | Mostly | rules, quiet hours, alert groups, daily summary, visit updates |
| Maps and API usage | `/settings/maps` | canOpenSettings | Partial (`usageReport` NONE) | maps settings, key check |
| Service types | `/settings/services` | requests.manage | Partial (default after-checklist NONE) | `/master/service-types` |

## 4. Request detail in depth

Header: status, priority, SLA pill or elapsed timer, created by, source, version.

Actions (`components/request-detail/actions.tsx`): Verify · Confirm (date, slot, UHID, H360 tests, fee, payment, transport, priority, notify picker) · Assign or Reassign (ranked candidates, outside HIS staff, team size, instructions, pick-up and return times, notify) · Close and invoice · Send email · Send WhatsApp · Visit report (`/print/report/:id`) · Reschedule · Cancel · Undo last step (`POST /revert`) · Delete.

Panels: patient confirmation status · accept timeout (keep waiting, accept for staff, reassign) · act for the team (accept, on the way, check in, complete now, car and driver, own transport with petty cash, car times) · transport documents · rides · live tracking (back at hospital) · visit update · bag · consumables · after-return checklist.

| Tab | Read API |
|---|---|
| overview (editable with `version`) | YES `GET /requests/:id` |
| timeline | YES (request document) |
| assignment | **NONE** (`AssignmentLog`) |
| visit (checklist, vitals, meds, notes, Rx, labs, photos, signature, transport, petty cash) | Partial; photo and signature list NONE |
| invoice (bills, H360 import, payment, rebill, sync, send) | YES `GET /requests/:id/bills` |
| messages (log, compose, care-team chat) | YES |
| attachments | **NONE** (no list endpoint) |
| audit | YES `GET /audit?entity=request&entityId=` |
| notified | **NONE** (`notifyTimeline`) |

Also server-only: `revertPreview`, `kitRows`, `afterRows`, recent pick-up times.

## 5. Field app (`app/m`)

Tabs by role (`tabsFor`): DRIVER → Trips, Vehicle, Notifications, Profile · TS → Trips, Fleet, Notifications, Profile · others → Home, Visits, Admin (if readAll), Notifications, Profile.

Screens: login · forgot (call the coordinator) · home (today, hero visit, KPIs, availability, quick tiles, accept or decline) · visits (today, upcoming, completed) · visit detail (timeline, bag, after-return, patient, steps, tests, transport, petty cash, rides, team) · check-in (GPS, accuracy, lock and require settings) · checklist · vitals (ranges, flag coordinator) · notes (dictation, meds) · Rx and labs · photos (camera, compression with time stamp) · consumables · confirmation (signature, WhatsApp OTP, verbal) · check-out (bill, payment, transport, remarks) · change request · internal chat (quick replies, photos) · directions · care plans · claims · trips (driver legs, supervisor assign car) · fleet · vehicle · route · notes · new request (GPS address block) · notifications · profile (photo, availability, preferences, sessions, password) · help · admin hub, inbox, request, confirm, assign, close, patients, store, WhatsApp.

Device features to replace natively:
- **Live GPS** (`components/field/LiveShare.tsx`): point every 5 s when moved 15 m, heartbeat 20 s, wake lock, pause beacon on hide, no offline buffering. Server: OUT phase until check-in, RETURN phase until hospital geofence (150 m), button, next visit or 4 h. Rough when accuracy is worse than 500 m. Patient link `/t/:token`.
- **Address GPS rule** (`components/client/AddressBlock.tsx`): stop early at ±12 m, green at ±60 m, amber up to ±300 m, never drop a pin from a worse fix; first-fix timeout 25 s, max watch 45 s.
- **Offline queue** (`components/field/live.tsx`, `sendOrQueue`): en-route, check-in, ticks, vitals, notes, meds, with `deviceAt` and `offline`. Check-out needs the network.
- Camera and compression (1600 px, JPEG 0.8, time stamp), signature canvas, speech dictation, `tel:` and wa.me links, map embeds.

## 6. Missing read endpoints (the gap list)

1. Dashboard KPIs, charts, escalations (`dashboardData`, `googleBudget`).
2. Board rows with date ranges (`boardRows`).
3. Patient board with filters and paging (`loadPatientBoard`).
4. Global search with exact-number jump.
5. Badge counts: open requests, store low stock, overdue loans, pending approvals.
6. Request detail: assignment log, attachment list, Notified timeline, undo preview, bag rows, after-return rows.
7. Visit report and prescription as JSON or PDF (today an HTML print page needing a staff session).
8. Staff sessions and last seen.
9. Services, consumables and staff reports as JSON (`lib/services/reports-more.ts`).
10. Fleet availability and trips today (`components/transport/data.ts`).
11. Store item loan figures (`loansByItem`) and tab counts.
12. Messages log filters and email KPIs; audit client filter and option lists.
13. Approval counts per type; a staff member's own change requests.
14. Maps usage (`usageReport`), booking link stats (`bookingLink`), alert groups (`hodConfig`), coordinator on duty, profile stats.
15. Patient-side JSON (out of scope: patients keep the website).

Permission mismatches: `GET /patients` needs requests.create (blocks VIEWER) · `GET /settings/whatsapp` needs canOpenSettings (blocks FD) · transport docs save needs canOpenSettings (blocks TS) · services and zones open with requests.manage but save needs master.manage · Roles page text says custom roles are not enforced, but they are.

## 7. Auth and sessions

- Cookie `hc_session`, JWT HS256 (`JWT_SECRET`), claims `sub`, `jti`, `role`, `aud` web or app; 30 days with remember, else 1 day. A `Session` row per login.
- Login rate limit: 8 failures per IP and identifier, then 15 minutes (in memory).
- Logout revokes the cookie session only. Workaround: `PATCH /users/me {signOutSessionId}`.
- Google sign-in: browser redirect with cookies (`lib/google-auth.ts`); the ID token is decoded without verifying its signature.
- Password reset: admin only (`PATCH /users/:id {resetPassword}` or `POST /users/:id/app-login` PIN on WhatsApp).

## 8. Realtime and notifications

Polling only (no sockets; SSE for WhatsApp pairing). Intervals: board and detail 20 s, dashboard and most `/m` 30 s, unread badge 30 s, chat 10 s, live maps 5 s, WhatsApp inbox 15 s, outbox count 30 s.

`notifyUsers()` writes `Notification` rows plus a `MessageLog` (PUSH, provider inapp), gated by `notificationRules` (event → recipient → channels; ASSIGNED → STAFF cannot be turned off). `User.notificationPrefs.push` exists but delivers nothing.

## 9. WhatsApp today

**How it works.** Baileys (`@whiskeysockets/baileys` 7) as a linked device; credentials in Mongo (`WaAuth`). No always-on server: each send or check opens a short session in a Vercel function under a Mongo lease (pump 90 s, pair 115 s, sync 40 s). Pump triggers: queueing (8 s batching, 20 s between sessions), approve, retry, send now, settings actions, sweep heartbeat, inbox sync.

**Statuses:** PENDING (Outbox) · PREPARED (wa.me) · QUEUED · SENT · DELIVERED · OPENED · SENT_CONFIRMED · FAILED · SKIPPED (discarded, opted out, not on WhatsApp, duplicate, too late, 48 h expiry) · RECEIVED.

**Safety (`lib/wa/guard.ts`):** 6 per minute, 60 per hour, 300 per day, 7-day warm-up from 40 a day, 4 per hour and 12 per day per person, 2 to 6 s pacing with typing, number check cached 30 days, 10-minute dedupe, quiet hours 22:00 to 07:00 for routine messages, priorities, staleness per template, STOP opt-out with confirmation, circuit breaker (30 min doubling to 12 h), logged-out detection.

**Existing features:**
- QR pairing (SSE) and 8-character phone-number code; connected, needs re-scan, not paired; check; disconnect.
- Approval Outbox: edit (original kept), send, discard, send all, do not send, 48 h expiry, drafts refreshed with latest tests and UHID.
- Review and send dock tied to the click (`x-wa-batch` header), scoped to the visit or all.
- Send now or send anyway for stuck, failed or discarded messages.
- Two-way inbox: people, groups, hidden numbers; photos and documents up to 10 MB; placeholders for voice, video, sticker, contact, poll; locations as maps links; reactions; deletions; messages typed on the phone; unread and seen; message info timeline; folded not-sent runs; filters and search; text replies.
- Templated messages for every lifecycle step, HOD alerts, live-update stream, car messages, daily summary, staff link.
- Documents: requisition and gate pass PDFs, bills, claim PDF and Excel, petty cash voucher.
- Notify picker on create, confirm, assign, reschedule, cancel, car allotted; decision stored for the Notified tab.
- wa.me tier with "I sent it"; custom message to patient; staff broadcast; template editor with versions.

**Not present:** sending location, files or voice from the inbox; voice and video playback; group creation; live arrival when no session is open.

Main endpoints: `GET/POST /outbox`, `PATCH /outbox/:id`, `GET /whatsapp/chats`, `GET/POST /whatsapp/chats/:to`, `POST /whatsapp/chats/:to/seen`, `POST /whatsapp/sync`, `POST /messages/whatsapp`, `/messages/custom`, `/messages/broadcast`, `POST /notify/preview`, `GET/PATCH/POST /settings/whatsapp`, `GET /settings/whatsapp/pair` (SSE), `GET/POST /settings/whatsapp/queue`.

## 10. Files, PDFs, exports

- `POST /attachments`: 4 MB, JPEG, PNG, WEBP or PDF; private Vercel Blob or inline in Mongo; downloads through `GET /attachments/:id`.
- PDFs with pdf-lib in `lib/forms/*` (requisition, gate pass, petty cash, claim with Excel). Visit report and Rx are HTML print pages only.
- CSV: `/audit?format=csv`, `/reports?format=csv&type=...`, `/patients/export`, plus several built in the browser.
- Browser-only work: document scanner, bill OCR (tesseract.js, unpdf), image editor, Kanban drag and drop, clipboard, `window.print`, sandboxed email preview.

## 11. Data model (`lib/models.ts`)

Master: Department, Designation, Zone, ServiceType, Equipment. Store: StockMove, StoreConsumption, StoreLoan, StoreIssue, StoreSnapshot. People: User, Session, Patient, HisEmployee, CustomRole. Requests: HomecareRequest, AssignmentLog, CarePlan, Prescription, LabResult, Note, ChatMessage, Approval, ExpenseClaim, StaffLink. Messaging: Notification, MessageLog, Template, WaContact, WaAuth, ShortLink. System: AuditLog, Setting, Counter, Vehicle, IntegrationSecret, LocationPing (30-day TTL), ApiUsage.

## 12. Settings keys (`lib/settings.ts`)

general · booking · maps · sla · email · whatsapp (approval ALL by default) · emailCopies · hodAlerts · features (autoAssign, gpsRequiredCheckIn, checkInGpsLocked, liveTracking, shareTrackingWithPatient, otpConfirmation, transportModule, pettyCash) · transportDocs · whatsappSafety · dailyWhatsApp · visitUpdates · quietHours · notificationRules.

## 13. Hosting

Vercel project `unico-homecare`, Hobby plan, region `sin1`, production domain `https://unico-homecare.vercel.app`. Crons: digest `0 14 * * *`, sweep `30 2 * * *`. Several routes set `maxDuration` 60 s (pairing 120 s).
