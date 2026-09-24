@AGENTS.md

# Unico HomeCare — project conventions

Home Care module for Unico Hospitals · Family Medicine (Dhaka). One Next.js 16 app deployed on Vercel:
web admin (coordinators, front desk, admins), a phone-first field app under `/m` (doctors, nurses, allied, drivers, car supervisor), and a REST API under `/api/v1`. Data in MongoDB Atlas via Mongoose.

- **Spec**: `ui/design/uploads/UNICO_HOME_CARE_MODULE_PLAN.md` (lifecycle, roles, data model, SLAs).
- **Designs**: `ui/design/*.dc.html` — static HTML mockups with inline styles; each screen is a `<div data-screen-label="W04">` (web 1440×900) or `M05` (mobile 390×844). Section labels (`1a`, `2c`…) describe each screen. Port layout, spacing, colours and copy faithfully, but wire them to real data.
- **English only.** Ignore every Bangla (BN) field, label, font or language toggle in the spec/designs.

## Commands
- `npm run dev` · `npm run build` · `npm run typecheck` (must pass) · `npm run seed -- --reset` (wipes + reseeds demo data)
- Seed logins (password `Unico@2026`): web `/login` → `N-0100` coordinator, `A-0001` super admin, `FD-0201` front desk, `V-0301` viewer. App `/m/login` → `11432` nurse, `11289` doctor, `11174` phlebotomist, `T-0031` car supervisor, `D-0041` driver.

## Layout
```
lib/constants.ts     roles, PERMISSIONS + can(), statuses/colours/TRANSITIONS, SLA, tests list, vitals ranges
lib/models.ts        all Mongoose models (typed Model<any> on purpose — generic inference OOMs tsc)
lib/db.ts            db() cached connection · plain() to serialise docs for client components
lib/auth.ts          getUser() (per-request cached), requireWebUser(perm?), requireAppUser(perm?)
lib/api.ts           route()/publicRoute() handler wrappers, body(req, zodSchema), ApiError helpers
lib/services/requests.ts  the lifecycle: create, confirm, assign, accept/decline, en-route, check-in,
                          checklist ticks, vitals, notes, meds, confirmation, check-out/complete, close,
                          reschedule, cancel, petty cash, transport, staff change requests, rankCandidates,
                          withPeople(rows) (joins staff/driver/vehicle), slaInfo(r)
lib/services/jobs.ts sweep() (accept timeouts + overdue), reminders(), dailyDigest()
lib/messaging.ts     queueEmail (Gmail SMTP, logged), prepareWhatsApp (wa.me deep link, logged), notifyUsers/notifyRoles, renderTemplate
lib/templates.ts     default message templates + emailShell()
lib/settings.ts      getSettings()/saveSetting() — non-secret config with defaults
lib/master.ts        generic master lists behind /api/v1/master/:kind
lib/format.ts        time(), day(), date(), dateTime(), relDay(), ago(), dur(), taka(), phone(), cx() — all Asia/Dhaka
components/ui        server-safe primitives: StatusChip, PriorityBadge, SlaPill, Tag, Avatar, Card, CardHeader, Label, Kpi,
                     Bars, HBars, Progress, btnClass, LinkButton, IconLink, Tabs, Chips, Table/Tr, Empty, KV, ToggleView, MapBox, MapPin, mapsUrl, telUrl
components/client    'use client': api(), useAction(), stamp(), ActionButton, Drawer, Sheet, Toggle, Segmented, ChipPicker,
                     WhatsAppButton, Elapsed, Countdown, AutoRefresh, UnreadBadge, compressImage, uploadFile, useToast
components/admin     Sidebar, AdminPage (top bar + content frame for every web page)
components/mobile    MScreen (top bar / body / sticky bottom bar / tab bar), MCard, MList, MRow, ContactBar, MSection, tabsFor(role)
app/(admin)/...      web pages (layout enforces web access)
app/m/(app)/...      field app pages (layout enforces app access); app/m/login is public
app/api/v1/...       REST endpoints (see below)
```

## API (all JSON; errors are `{ error: { code, message, fields? } }`)
- `POST /auth/login {identifier,password,client}` · `POST /auth/logout` · `GET /auth/me`
- `GET/POST /requests` (filters: status, priority, service, zone, date, staff, q, mine) · `GET/PATCH /requests/:id`
- `POST /requests/:id/:action` — verify · confirm · assign · reschedule · cancel · close · invoice · petty-cash-decide · transport · transport-leg · accept · decline · en-route · check-in · checklist-add · vitals · notes · medication · confirmation · check-out · complete · petty-cash · change-request (schemas in lib/services/requests.ts)
- `PATCH /requests/:id/checklist/:key {done, note?, reason?}` · `GET /requests/:id/candidates?role=`
- `GET/POST /patients` · `GET/PATCH /patients/:id` · `GET/POST /users` · `GET/PATCH /users/:id` · `GET/PATCH /users/me`
- `GET/POST /master/:kind` · `PATCH/DELETE /master/:kind/:id` (departments, designations, zones, service-types, vehicles)
- `GET/POST(read-all) /notifications` · `PATCH /notifications/:id`
- `GET /messages` · `GET/PATCH /messages/:id` · `POST /messages/whatsapp` · `POST /messages/email`
- `POST /attachments` (multipart) · `GET/DELETE /attachments/:id` · `GET /audit` (`format=csv`) · `GET/PATCH/POST /settings` · `GET /jobs/:job` (cron)

## Rules
- Server components read Mongo directly (`await db()`, lean queries, `plain()` before passing to client components) — no fetch to our own API from the server. Client components mutate via `api()` / `useAction()` / `ActionButton`, then `router.refresh()`.
- Every mutation goes through a service or route that calls `audit()` (append-only). Never update/delete `audit_logs`.
- Validate input with zod in `lib/schemas.ts` or next to the service. Route files may only export HTTP handlers.
- Field staff may only see requests where they are on the team (`canView`). Check permissions server-side with `can(role, perm)`.
- Next 16: `params`/`searchParams` are Promises (`await`), `proxy.ts` replaces middleware, route handler context `{ params: Promise<…> }`.
- Styling: Tailwind v4 tokens in `app/globals.css` (`primary` #0090CA, `primary-700`, `primary-50`, `navy` #1F3864, `teal`, `page`, `shadow-card`, `rounded-card`); neutrals are Tailwind `slate-*` (identical to the design). Inputs use `.hc-input` (+ `.hc-input-lg` on mobile) and labels `.hc-label`.
- Mobile: min 44–52px tap targets, one primary bottom-anchored action per screen (`MScreen bottom=`), times shown inline.
