import 'server-only'
import { ApiUsage, Setting } from './models'
import { isoDay } from './format'
import type { getSettings } from './settings'

// Map-provider call ledger. Browsers call Google / OpenStreetMap directly, so pages report each call here
// (POST /api/v1/public/maps-usage) and the server decides, per day, whether Google may still be used.

export type MapsCfg = Awaited<ReturnType<typeof getSettings>>['maps']
export const PROVIDERS = ['google', 'osm', 'device'] as const
export const KINDS = ['places_autocomplete', 'places_details', 'maps_js', 'routes', 'photon_search', 'photon_reverse', 'osm_map', 'osrm_route', 'embed', 'gps'] as const
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  places_autocomplete: 'Google · address suggestions',
  places_details: 'Google · place details',
  maps_js: 'Google · map loads',
  routes: 'Google · road route + ETA (live tracking)',
  osrm_route: 'OpenStreetMap · road route (free)',
  photon_search: 'OpenStreetMap · address search',
  photon_reverse: 'OpenStreetMap · location → address',
  osm_map: 'OpenStreetMap · map loads',
  embed: 'Google · embedded previews (free)',
  gps: 'Phone GPS (free, no API)',
}

export async function recordUsage(provider: string, kind: string, n = 1) {
  await ApiUsage.updateOne({ day: isoDay(), provider, kind }, { $inc: { n } }, { upsert: true })
}

const monthStart = (day: string) => `${day.slice(0, 7)}-01`
const daysInMonth = (day: string) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0).getDate()

/** The billable Google APIs. Google's free tier is per API (SKU): each gets `monthlyFree` calls a month on its own. */
export const GOOGLE_KINDS = ['maps_js', 'places_autocomplete', 'places_details', 'routes'] as const
export type GoogleKind = (typeof GOOGLE_KINDS)[number]

/** Google calls so far today and this month, per billable API. */
export async function googleUsage() {
  const today = isoDay()
  const rows = await ApiUsage.find({ provider: 'google', kind: { $in: GOOGLE_KINDS }, day: { $gte: monthStart(today) } }).lean<any[]>()
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((a, r) => a + (r.n ?? 0), 0)
  const kinds = Object.fromEntries(GOOGLE_KINDS.map((k) => [k, { today: sum((r) => r.kind === k && r.day === today), month: sum((r) => r.kind === k) }])) as Record<GoogleKind, { today: number; month: number }>
  return { today: sum((r) => r.day === today), month: sum(() => true), day: today, kinds }
}

/**
 * Google's free calls a month depend on the API's tier (since March 2025): Essentials 10,000, Pro 5,000. Map loads,
 * address suggestions and place details (location + address only) are Essentials; traffic-aware routes are Pro.
 * `monthlyFree` in Settings is the Essentials number; Pro gets half of it.
 */
export const FREE_TIER: Record<GoogleKind, 'essentials' | 'pro'> = { maps_js: 'essentials', places_autocomplete: 'essentials', places_details: 'essentials', routes: 'pro' }
const freeOf = (cfg: MapsCfg, k: GoogleKind) => {
  const base = Number(cfg.monthlyFree) || 10000
  return FREE_TIER[k] === 'pro' ? Math.floor(base / 2) : base
}
const monthlyCapOf = (cfg: MapsCfg, k: GoogleKind = 'maps_js') => Math.floor(freeOf(cfg, k) * (1 - (Number(cfg.reservePct) || 0) / 100))
/** A fresh month's even share per day (Essentials) — shown as the starting point in Settings. */
export const suggestedDailyCap = (cfg: MapsCfg, day = isoDay()) => Math.max(10, Math.floor(monthlyCapOf(cfg) / daysInMonth(day)))
/**
 * Automatic daily cap with roll-over: what is left of this month's free calls ÷ the days left (today included), so a
 * quiet day's unused calls can be used later and the whole free allowance gets used, never more.
 */
function rolloverCap(cfg: MapsCfg, k: GoogleKind, u: { today: number; month: number }, day: string) {
  const left = Math.max(0, monthlyCapOf(cfg, k) - (u.month - u.today)) // free calls left at the start of today
  const daysLeft = daysInMonth(day) - Number(day.slice(8, 10)) + 1
  return Math.floor(left / Math.max(1, daysLeft))
}

type Reason = 'ok' | 'off' | 'no-key' | 'daily-cap' | 'monthly-cap' | 'refused'
export type KindBudget = { ok: boolean; reason: Reason; today: number; month: number; dailyCap: number; monthlyCap: number; remainingToday: number }

/**
 * May the pages use Google right now — overall and per API? Each API has its own monthly allowance and an even daily
 * share; when one runs out only that API falls back to the free provider (e.g. address search → Photon while maps stay
 * on Google). `refused`: the last check found the key or project refused by Google (see probeGoogle).
 */
export async function googleBudget(cfg: MapsCfg): Promise<{ allowed: boolean; reason: Reason; message?: string; checkedAt?: string; remainingToday: number; dailyCap: number; monthlyCap: number; used: { today: number; month: number }; kinds: Record<GoogleKind, KindBudget> }> {
  const [used, probe] = await Promise.all([googleUsage(), lastProbe()])
  const auto = cfg.dailyCap === 'auto' || !cfg.dailyCap
  const global: Reason | null = !cfg.useGoogle ? 'off' : !process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ? 'no-key' : probe && !probe.ok ? 'refused' : null
  const kinds = Object.fromEntries(
    GOOGLE_KINDS.map((k) => {
      const u = used.kinds[k]
      const monthlyCap = monthlyCapOf(cfg, k)
      const dailyCap = auto ? rolloverCap(cfg, k, u, used.day) : Math.min(Number(cfg.dailyCap), monthlyCap)
      const reason: Reason = global ?? (u.month >= monthlyCap ? 'monthly-cap' : u.today >= dailyCap ? 'daily-cap' : 'ok')
      return [k, { ok: reason === 'ok', reason, today: u.today, month: u.month, dailyCap, monthlyCap, remainingToday: Math.max(0, dailyCap - u.today) }]
    }),
  ) as Record<GoogleKind, KindBudget>
  const list = Object.values(kinds)
  const allowed = list.some((k) => k.ok)
  const reason: Reason = allowed ? 'ok' : (global ?? (list.some((k) => k.reason === 'daily-cap') ? 'daily-cap' : 'monthly-cap'))
  return {
    allowed,
    reason,
    message: probe && !probe.ok ? probe.message : undefined,
    checkedAt: probe?.at ? new Date(probe.at).toISOString() : undefined,
    remainingToday: kinds.maps_js.remainingToday,
    dailyCap: kinds.maps_js.dailyCap,
    monthlyCap: kinds.maps_js.monthlyCap,
    used: { today: used.today, month: used.month },
    kinds,
  }
}

// ---------------------------------------------------------------- does Google accept the key? (one tiny call)
// Google's JS map shows its own "can't load" dialog instead of failing detectably, so the server checks first.
// The result is kept in Mongo (shared by all server instances): a good answer for 6 h, a refusal for 15 min.
type Probe = { ok: boolean; at: number; status?: number; message?: string }
const PROBE_KEY = 'maps:probe'
const OK_TTL = 6 * 3600_000
const FAIL_TTL = 15 * 60_000

async function lastProbe(): Promise<Probe | null> {
  return ((await Setting.findOne({ key: PROBE_KEY }).select('value').lean<any>())?.value as Probe) ?? null
}

/** Check (or re-check when stale / forced) that Google accepts the key; keeps Google's own error text. */
export async function probeGoogle(origin: string, force = false): Promise<Probe> {
  const prev = await lastProbe()
  if (!force && prev && Date.now() - prev.at < (prev.ok ? OK_TTL : FAIL_TTL)) return prev
  const key = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  let p: Probe
  if (!key) p = { ok: false, at: Date.now(), message: 'No Google key configured' }
  else {
    try {
      const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key, referer: `${origin}/` },
        body: JSON.stringify({ input: 'Dhaka', includedRegionCodes: ['bd'] }),
      })
      const j: any = res.ok ? null : await res.json().catch(() => null)
      p = { ok: res.ok, at: Date.now(), status: res.status, message: res.ok ? undefined : explain(res.status, j?.error?.message) }
    } catch (e: any) {
      p = { ok: false, at: Date.now(), message: `Google could not be reached (${e?.name === 'TimeoutError' ? 'timeout' : 'network'})` }
    }
  }
  await Setting.updateOne({ key: PROBE_KEY }, { value: p }, { upsert: true })
  return p
}

function explain(status: number, msg?: string) {
  if (status === 403 && /not activated|not enabled|does not have permission|PERMISSION_DENIED/i.test(msg ?? 'permission'))
    return `Google refused the key (${status}): the Maps APIs are not enabled on the Google Cloud project. Enable "Maps JavaScript API" and "Places API (New)" and link a billing account (needed even for the free monthly calls).`
  if (status === 403 && /referer|referrer/i.test(msg ?? '')) return `Google refused the key (${status}): this website is not in the key's allowed websites (HTTP referrers).`
  if (status === 429) return 'Google answered "too many requests" (429): the daily quota in Google Cloud is used up.'
  return `Google refused the key (${status})${msg ? `: ${msg}` : ''}`
}

/** Per-day totals for the settings page (last `days` days, every provider / kind). */
export async function usageReport(days = 14) {
  const today = isoDay()
  const from = isoDay(Date.now() - (days - 1) * 86400_000)
  const rows = await ApiUsage.find({ day: { $gte: from } }).lean<any[]>()
  const dates = Array.from({ length: days }, (_, i) => isoDay(Date.now() - (days - 1 - i) * 86400_000))
  const perDay = dates.map((d) => ({ day: d, google: 0, osm: 0, device: 0 }))
  const byKind: Record<string, { today: number; month: number; total: number }> = {}
  for (const r of rows) {
    const pd = perDay.find((x) => x.day === r.day)
    if (pd && r.provider in pd) (pd as any)[r.provider] += r.n ?? 0
    const k = (byKind[r.kind] ??= { today: 0, month: 0, total: 0 })
    k.total += r.n ?? 0
    if (r.day === today) k.today += r.n ?? 0
    if (r.day >= monthStart(today)) k.month += r.n ?? 0
  }
  return { perDay, byKind }
}
