import 'server-only'
import { ApiUsage } from './models'
import { isoDay } from './format'
import type { getSettings } from './settings'

// Map-provider call ledger. Browsers call Google / OpenStreetMap directly, so pages report each call here
// (POST /api/v1/public/maps-usage) and the server decides, per day, whether Google may still be used.

export type MapsCfg = Awaited<ReturnType<typeof getSettings>>['maps']
export const PROVIDERS = ['google', 'osm', 'device'] as const
export const KINDS = ['places_autocomplete', 'places_details', 'maps_js', 'photon_search', 'photon_reverse', 'osm_map', 'embed', 'gps'] as const
export const KIND_LABEL: Record<(typeof KINDS)[number], string> = {
  places_autocomplete: 'Google · address suggestions',
  places_details: 'Google · place details',
  maps_js: 'Google · map loads',
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

/** Google calls so far today and this month (only the billable kinds count against the free tier). */
export async function googleUsage() {
  const today = isoDay()
  const rows = await ApiUsage.find({ provider: 'google', kind: { $ne: 'embed' }, day: { $gte: monthStart(today) } }).lean<any[]>()
  const sum = (f: (r: any) => boolean) => rows.filter(f).reduce((a, r) => a + (r.n ?? 0), 0)
  return { today: sum((r) => r.day === today), month: sum(() => true), day: today }
}

/** Suggested daily cap: the monthly free calls spread evenly over the month, less a safety margin. */
export const suggestedDailyCap = (cfg: MapsCfg, day = isoDay()) => Math.max(10, Math.floor(((Number(cfg.monthlyFree) || 10000) * (1 - (Number(cfg.reservePct) || 0) / 100)) / daysInMonth(day)))

/** May the public pages use Google right now? */
export async function googleBudget(cfg: MapsCfg): Promise<{ allowed: boolean; reason: 'ok' | 'off' | 'no-key' | 'daily-cap' | 'monthly-cap'; remainingToday: number; dailyCap: number; used: { today: number; month: number } }> {
  const used = await googleUsage()
  const dailyCap = cfg.dailyCap === 'auto' || !cfg.dailyCap ? suggestedDailyCap(cfg, used.day) : Number(cfg.dailyCap)
  const monthlyCap = Math.floor((Number(cfg.monthlyFree) || 10000) * (1 - (Number(cfg.reservePct) || 0) / 100))
  const remainingToday = Math.max(0, dailyCap - used.today)
  const base = { remainingToday, dailyCap, used: { today: used.today, month: used.month } }
  if (!cfg.useGoogle) return { allowed: false, reason: 'off', ...base }
  if (!process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) return { allowed: false, reason: 'no-key', ...base }
  if (used.month >= monthlyCap) return { allowed: false, reason: 'monthly-cap', ...base }
  if (used.today >= dailyCap) return { allowed: false, reason: 'daily-cap', ...base }
  return { allowed: true, reason: 'ok', ...base }
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
