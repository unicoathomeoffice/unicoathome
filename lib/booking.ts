import 'server-only'
import { HomecareRequest } from './models'
import { dhakaDate, isoDay } from './format'
import type { getSettings } from './settings'

// Online booking: slots are generated from Settings → Online booking (hours, slot length, buffer) and
// fill up dynamically — every confirmed visit overlapping a slot (incl. its buffer) uses one of its places.

export type BookingCfg = Awaited<ReturnType<typeof getSettings>>['booking']
export type SlotState = 'open' | 'full' | 'past' | 'blocked' | 'closed'
export type SlotInfo = { start: string; end: string; label: string; booked: number; capacity: number; state: SlotState }
export type DayInfo = { date: string; weekday: number; closed: boolean; slots: SlotInfo[] }

/** Statuses that hold a slot: confirmed onwards (plus new/verified when holdNew is on). */
const HOLDING = ['CONFIRMED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED', 'CLOSED']
const toMin = (hm: string) => {
  const [h, m] = hm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

/** Slot starts/ends for one day: from, then every slotMin + bufferMin, while the slot still ends by `to`. */
export function daySlots(cfg: BookingCfg) {
  const out: { start: string; end: string; label: string }[] = []
  const len = Math.max(15, Number(cfg.slotMin) || 60)
  const step = len + Math.max(0, Number(cfg.bufferMin) || 0)
  for (let t = toMin(cfg.from); t + len <= toMin(cfg.to) && out.length < 48; t += step) out.push({ start: hhmm(t), end: hhmm(t + len), label: `${hhmm(t)}–${hhmm(t + len)}` })
  return out
}

/** Availability for the booking window (today + daysAhead), live from the requests collection. */
export async function availability(cfg: BookingCfg, opts: { days?: number; from?: string } = {}): Promise<DayInfo[]> {
  const days = Math.min(Math.max(opts.days ?? cfg.daysAhead ?? 14, 1), 60)
  const first = opts.from ?? isoDay()
  const dates = Array.from({ length: days }, (_, i) => isoDay(dhakaDate(first, '12:00').getTime() + i * 86400_000))
  const slots = daySlots(cfg)
  const buffer = Math.max(0, Number(cfg.bufferMin) || 0) * 60_000
  const rangeStart = dhakaDate(dates[0], '00:00')
  const rangeEnd = new Date(dhakaDate(dates[dates.length - 1], '00:00').getTime() + 86400_000)
  const visits = await HomecareRequest.find({
    deletedAt: null,
    status: { $in: cfg.holdNew ? ['NEW', 'VERIFIED', ...HOLDING] : HOLDING },
    scheduledAt: { $gte: new Date(rangeStart.getTime() - 6 * 3600_000), $lt: rangeEnd },
  })
    .select('scheduledAt expectedDurationMin')
    .lean<any[]>()
  const spans = visits.map((v) => {
    const s = new Date(v.scheduledAt).getTime()
    return [s, s + (Number(v.expectedDurationMin) || Number(cfg.slotMin) || 60) * 60_000 + buffer] as const
  })
  const earliest = Date.now() + (Number(cfg.leadMin) || 0) * 60_000
  const capacity = Math.max(1, Number(cfg.capacity) || 1)
  const blocked = new Set(cfg.blocked ?? [])

  return dates.map((date) => {
    const weekday = new Date(`${date}T12:00:00+06:00`).getUTCDay()
    const closed = (cfg.closedWeekdays ?? []).includes(weekday) || (cfg.closedDates ?? []).includes(date)
    return {
      date,
      weekday,
      closed,
      slots: slots.map((sl) => {
        const a = dhakaDate(date, sl.start).getTime()
        const b = dhakaDate(date, sl.end).getTime()
        const booked = spans.filter(([s, e]) => s < b && e > a).length
        const state: SlotState = closed ? 'closed' : blocked.has(`${date} ${sl.start}`) ? 'blocked' : a < earliest ? 'past' : booked >= capacity ? 'full' : 'open'
        return { ...sl, booked, capacity, state }
      }),
    }
  })
}

/** Is this exact slot bookable right now? (re-checked on submit, so a just-filled slot is refused) */
export async function slotOpen(cfg: BookingCfg, date: string, label: string) {
  const [day] = await availability(cfg, { from: date, days: 1 })
  return day?.slots.find((s) => s.label === label)?.state === 'open'
}
