# Unico HomeCare

Home Care Module for **Unico Hospitals PLC · Family Medicine** (Dhaka). It covers the whole home-care flow: a request comes in, a coordinator confirms it and assigns the right staff, and each visit is tracked from acceptance to a timed completion tick. Every action is logged.

| Surface | URL | Who |
|---|---|---|
| Web admin | `/login` → `/dashboard` | Super admin, Home Care Coordinator, Front desk, Management (read-only) |
| Field app (phone-first, installable) | `/m/login` → `/m` | Doctors, nurses, allied health, car supervisor, drivers (coordinators too) |
| REST API | `/api/v1/*` | Both surfaces; ready for a future native app (bearer token via `x-hc-native: 1`) |

**Stack:** Next.js 16 (App Router, Route Handlers) · React 19 · TypeScript · Tailwind CSS 4 · MongoDB Atlas + Mongoose · JWT sessions (jose, httpOnly cookie) · Gmail SMTP (Nodemailer) · WhatsApp deep links · Vercel (hosting + cron).

## What's inside

- **Lifecycle:** NEW → VERIFIED → CONFIRMED → ASSIGNED → ACCEPTED → EN_ROUTE → IN_PROGRESS → COMPLETED → CLOSED, plus RESCHEDULED and CANCELLED. The server validates every transition, stamps a time for each one, and writes it to an append-only audit log.
- **Assignment:** candidates are ranked by skill (40), availability (30), zone (20) and workload (10). Staff accept or decline. Acceptance times out after 15 minutes and the request escalates to the coordinator.
- **Visit execution:** start journey, check-in (optional GPS), checklist ticks with times, vitals with abnormal-value flags, notes and medications, time-stamped photos, patient signature / OTP / verbal confirmation, then check-out with bill and paid/due status, and completion. A visit report PDF is generated at the end.
- **Everything from the Google Form** is captured by the right role at the right stage: UHID, tests and procedures, care-team size and members, transport (Unico car / Rickshaw / Uber / Pathao), car and driver, petty cash, bill amount, billing status, invoice number/total/print status, and service start/end times.
- **Transport:** a car supervisor assigns cars and drivers, and drivers stamp each trip leg.
- **Communication:** in-app notifications, Gmail email templates (logged, with resend), and WhatsApp prefilled messages (logged, with "I sent it" confirmation). There is also a chat thread per visit, and staff notes.
- **Admin:** staff and users (web/app platform access), designations, departments, service types with checklist editor, zones, slots, SLA rules, fleet, approvals queue, templates editor, notification rules, reports with CSV export, and an audit log with before/after diffs.

## Local setup

```bash
npm install
cp .env.example .env.local      # then fill in MONGODB_URI and JWT_SECRET (see below)
npm run seed                    # demo data (use `npm run seed -- --reset` to wipe and reseed)
npm run dev                     # http://localhost:3000
```

Demo logins (password `Unico@2026`, or whatever `SEED_ADMIN_PASSWORD` is set to):

| Web `/login` | | App `/m/login` | |
|---|---|---|---|
| `N-0100` | Coordinator (Nasrin Sultana) | `11432` | Nurse (Nasif Ahammed Niloy) |
| `A-0001` | Super admin | `11289` | Doctor (Dr Md Abdur Rashid) |
| `FD-0201` | Front desk | `11174` | Phlebotomist |
| `V-0301` | Management viewer | `T-0031` | Car supervisor · `D-0041` Driver |

Field staff are **app-only**. Signing in to the web admin with their accounts is refused by design.

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | ✅ | Atlas connection string with database name `unico_homecare`. The SRV form `mongodb+srv://…` works on Vercel. |
| `JWT_SECRET` | ✅ | 32+ random characters: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `APP_BASE_URL` | ✅ in prod | e.g. `https://unico-homecare.vercel.app`. Used in email links and feedback links. |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | for email | Turn on 2-Step Verification on the Google account, then create an App Password. If these are blank, emails are logged as *SKIPPED*. |
| `EMAIL_FROM_NAME`, `DEPARTMENT_EMAIL` | optional | Sender name, and the department address that receives visit reports. |
| `HOSPITAL_PHONE`, `WA_DEFAULT_COUNTRY` | optional | Shown in patient messages. The country code defaults to `880`. |
| `CRON_SECRET` | for cron | Vercel Cron sends it as a Bearer token to `/api/v1/jobs/*`. |

Secrets live only in env vars and are never stored in MongoDB.

## Deploy to Vercel

1. Push this folder to a GitHub repo. `.env.local` and the design bundle are git-ignored.
2. In Vercel, click **Add New → Project**, import the repo, and keep the framework preset **Next.js**. No root-directory change is needed.
3. Under **Settings → Environment Variables**, add the variables above for Production (and Preview if you use it).
4. **MongoDB Atlas → Network Access → Add IP Address → `0.0.0.0/0`.** Vercel functions have no fixed IPs, so without this they can't reach the cluster.
5. Deploy. `vercel.json` pins the functions to Singapore (`sin1`, the closest region to Dhaka) and schedules two crons:
   - `/api/v1/jobs/digest` daily at 20:00 Dhaka (daily digest email)
   - `/api/v1/jobs/sweep` daily (acceptance timeouts and overdue alerts)

   The sweep also runs automatically, at most once a minute, whenever the dashboard or boards are open. So timeouts are handled even on the Hobby plan, where crons can only run daily. On Vercel Pro you can change the sweep schedule to `*/5 * * * *` and add `/api/v1/jobs/reminders` every 5 minutes.
6. Seed production once, from your machine: `MONGODB_URI=<prod uri> npm run seed`. Then sign in as `A-0001`, **change the passwords**, and create the real staff under **Staff**.

> Vercel's Hobby plan is for non-commercial use. For hospital production use, choose **Pro**.

## Project layout

See [CLAUDE.md](CLAUDE.md) for the full map, API list and coding rules. In short:

```
app/(admin)/…      web admin pages          app/m/(app)/…   field app pages
app/api/v1/…       REST API                 lib/services/   lifecycle, jobs, reports, approvals…
lib/models.ts      Mongoose models          components/     ui kit, client helpers, shells
ui/design/         original design mockups + module plan (reference only)
ui/tools/          screen.mjs (render a design screen) · shot.mjs (screenshot the running app)
```

## Scripts

`npm run dev` · `npm run build` · `npm start` · `npm run typecheck` · `npm run seed [-- --reset]`
