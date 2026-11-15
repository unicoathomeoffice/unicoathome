// Visit dates of a repeating schedule (pure — no imports, tested on its own). Dates are Dhaka calendar days 'YYYY-MM-DD'.
//   pattern: DAILY · WEEKDAYS (chosen days, 0 = Sun) · EVERY_N (every N days from the start)
//   end:     COUNT (N visits) · UNTIL (a last date) · ONGOING (until stopped)
// Skipped dates are not visits and don't count towards COUNT.

export type SchedPattern = { kind: 'DAILY' | 'WEEKDAYS' | 'EVERY_N'; daysOfWeek?: number[]; everyDays?: number }
export type SchedEnd = { kind: 'COUNT' | 'UNTIL' | 'ONGOING'; count?: number; until?: string }
export type SchedRule = { start: string; pattern: SchedPattern; end: SchedEnd; skip?: string[] }

const DAY = 86400_000
const asDate = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
const ymdOf = (d: Date) => d.toISOString().slice(0, 10)
export const addDays = (ymd: string, n: number) => ymdOf(new Date(asDate(ymd).getTime() + n * DAY))
const MAX_DAYS = 800 // never loop more than ~2 years

function matches(p: SchedPattern, start: string, ymd: string) {
  if (p.kind === 'DAILY') return true
  if (p.kind === 'WEEKDAYS') return (p.daysOfWeek ?? []).includes(asDate(ymd).getUTCDay())
  const n = Math.max(1, Math.round(p.everyDays ?? 1))
  return Math.round((asDate(ymd).getTime() - asDate(start).getTime()) / DAY) % n === 0
}

/** The schedule's visit dates between from and to (inclusive), respecting the end rule counted from the start. */
export function scheduleDates(rule: SchedRule, from: string, to: string): string[] {
  const skip = new Set(rule.skip ?? [])
  const out: string[] = []
  let made = 0
  const last = rule.end.kind === 'UNTIL' && rule.end.until ? rule.end.until : null
  for (let i = 0; i < MAX_DAYS; i++) {
    const d = addDays(rule.start, i)
    if (d > to || (last && d > last)) break
    if (!matches(rule.pattern, rule.start, d) || skip.has(d)) continue
    if (rule.end.kind === 'COUNT' && made >= Math.max(1, rule.end.count ?? 1)) break
    made++
    if (d >= from) out.push(d)
  }
  return out
}

/** "Mon · Wed · Fri" / "Daily" / "Every 3 days" + the end ("10 visits", "until 30 Nov", "ongoing"). */
export function describeSchedule(p: SchedPattern, e: SchedEnd) {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const what = p.kind === 'DAILY' ? 'Daily' : p.kind === 'EVERY_N' ? `Every ${p.everyDays ?? 1} days` : (p.daysOfWeek ?? []).slice().sort().map((d) => DAYS[d]).join(' · ') || 'No days'
  const until = e.kind === 'COUNT' ? `${e.count} visits` : e.kind === 'UNTIL' && e.until ? `until ${new Date(`${e.until}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}` : 'ongoing'
  return `${what} · ${until}`
}
