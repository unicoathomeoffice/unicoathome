You are building the native Android app for Unico HomeCare, the home care system of Unico Hospitals, Family Medicine, Dhaka. Work on your own tonight; nobody will answer questions until morning, so make sensible choices, write them down, and keep going.

## Read first
- This Android project lives at `C:\androidapp\UnicoHomeCare` (no spaces in the path, because NDK tools fail on them). It is its own git repository.
- The full specification is in this project's `docs/ANDROID_APP_PROMPT.md` and the system inventory in `docs/ANDROID_APP_AUDIT.md`. Read both. The section "Status: server work already done" at the top of the specification lists the endpoints that exist.
- The server is a separate Next.js app at `C:\xampp\htdocs\Unico at home`. **Do not change any file there.** Another tool edits the server.

## What to build tonight (Phase 1 and 2: the foundation)
A Kotlin + Jetpack Compose app, package `com.unico.homecare`, app name "Unico HomeCare", minimum SDK 26, target the newest installed SDK (36). The project was created from the Empty Activity (Compose) template; replace its sample code. Single activity, Navigation Compose, Material 3, coroutines and Flow, Hilt, Retrofit or Ktor with kotlinx.serialization, Room, DataStore, EncryptedSharedPreferences (or Keystore) for the token, Coil. Gradle Kotlin DSL with a version catalog.

1. **Design system (glassmorphism).** Brand: primary `#0090CA`, primary-700 `#0072A3`, primary-50 `#E8F5FB`, teal `#3AB5A7`, navy `#1F3864`, page `#F1F5F9`, text `#0F172A`, neutrals Tailwind slate, status colours green `#16A34A`, amber `#F59E0B`, red `#DC2626`, violet `#6D28D9`. Font DM Sans. Backdrop: soft slowly moving gradient of the brand colours. Surfaces: translucent fill, fine light border, soft shadow, 20 to 28 dp corners; real blur only on chrome (top bar, floating pill tab bar, bottom sheets, main button) on Android 12+, tinted fallback below 12 and inside long lists. Body text keeps 4.5:1 contrast; inputs sit on near-solid fills. Light and dark themes, plus a "reduce transparency" switch. Components: GlassCard, PrimaryButton, SecondaryButton, TextField, Chip, StatusChip, PriorityBadge, SlaPill, ListRow, BottomSheet, TopBar, FloatingTabBar, Skeleton, EmptyState, Kpi tile, Avatar. Targets at least 48 dp.
2. **Sign-in screen.** Employee ID / phone / email and password. Credit line at the bottom: "Design and developed by Nasif Ahammed Niloy (nasifahammedniloy.com)", the site name opening in the browser.
3. **Networking and session.** Base URL from BuildConfig: debug `http://10.0.2.2:3000/api/v1` (allow cleartext for debug only, through a network security config), release `https://unico-homecare.vercel.app/api/v1`. Never show the address in the UI and never use a WebView. Every call sends `Authorization: Bearer <token>`. Errors arrive as `{ "error": { "code", "message", "fields" } }`; show `message`. On 401 go to sign-in.
4. **App config drives everything.** After sign-in and on every resume call `GET /app/config?build=<versionCode>`. Draw the bottom tabs from `tabs` (up to 4 module keys) plus a fifth "More" tab, a grid of every item in `modules` grouped by `group`, with Material Symbols icons from `icon` and badges from `badges[module.badge]`. No role logic in the app. If `app.maintenance` is set, show a blocking screen. If `app.mustUpdate`, block with an update screen; if `app.updateAvailable`, offer it.
5. **Screens tonight:** Dashboard (read-all users: `GET /dashboard`; everyone else: `GET /app/home` as "Today"), Requests board (`GET /board`, status columns as swipeable tabs plus a list view, filter sheet), Notifications (`GET /notifications`, `PATCH /notifications/:id`, `POST /notifications` marks all read), Search (`GET /search?q=`; open `exact` directly), Account (`GET /users/me`, change password, sign-out of sessions, `PATCH /users/me`), About (app version, credit line). Every other module key opens a "Coming soon" placeholder that names the module.
6. **Device registration.** Make a random `installId` once per install. After sign-in and on each start call `POST /devices {installId, model, osVersion, appVersion, appBuild}`. Sign out with `POST /auth/logout`. Call `POST /auth/refresh` when the token has less than 7 days left.

## Endpoints (already built on the server)
| Call | Returns |
|---|---|
| `POST /auth/login` header `x-hc-native: 1`, body `{identifier, password, client: "app", remember: true}` | `token`, `expiresAt`, `user` |
| `POST /auth/refresh` | new `token`, `expiresAt` |
| `POST /auth/logout` | revokes this session |
| `POST /devices`, `GET /devices`, `DELETE /devices/{installId}` | phone registration |
| `GET /app/config?build=N` | `user`, `permissions`, `modules[{key,label,group,icon,badge}]`, `tabs`, `badges`, `features`, `general`, `sla`, `whatsapp`, `enums` (statuses with `label`, `colors` [bg, text, dot], `next`), `app` (update and maintenance), `credit` |
| `GET /app/badges` | `unread`, `open`, `outbox`, `approvals`, `store` |
| `GET /app/home` | `today[]`, `hero`, `awaiting`, `notes`, `unread`, `completed` |
| `GET /dashboard` | `kpis`, trend, `metrics`, live list, escalations, mixes, `maps` |
| `GET /board?status&priority&service&zone&staff&date&q` | `rows[]`, `options` |
| `GET /search?q=` | `exact`, `requests[]`, `patients[]` |
| `GET /requests/{id}` and `GET /requests/{id}/extras?parts=...` | request detail (for tomorrow) |

Decode JSON leniently (`ignoreUnknownKeys = true`, nullable fields with defaults): the server returns more fields than you model.

## How to check your work
- You cannot sign in tonight: the local database holds real staff, and there is no test account. So give every screen a Compose `@Preview` with realistic sample data (Dhaka patient names, statuses, times), and a fake repository the previews and a "demo" debug flavour use.
- Build with Gradle after each step and fix every error and warning you introduced. Run the unit tests. If an emulator is available (`Pixel_8_Nurse`), install the debug build and confirm the sign-in screen and the demo flavour's screens open without crashing.
- Check each preview in light and dark, at phone and tablet width, with a large font.

## Rules
- English only in the UI.
- Commit to this project's own git repository often, with clear messages (run `git init` first if it has none, and add a standard Android `.gitignore`). Never push. Never commit keystores, `google-services.json` or secrets.
- Stop a step rather than guess if it would need a server change; write the need down instead.

## Before you finish
Write `PROGRESS.md` at the root of this Android project: what is done, what was verified and how, what failed or was skipped, the decisions you made, and the server changes you need. Keep it honest; the owner reads it in the morning.
