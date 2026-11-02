import 'server-only'
import { ExpenseClaim, HomecareRequest, Setting } from '../models'
import { getSettings } from '../settings'
import { renderTemplate, waNumber } from '../messaging'
import { isPaired } from '../wa/status'
import { dayRange, isoDay, taka } from '../format'

// Daily WhatsApp summary (Settings → Notification rules): today's visits, timings, money and tomorrow's bookings,
// sent once a day to the chosen people at the chosen time. Vercel's free plan runs cron once a day, so the send is
// triggered by activity (sweep) after that time, with the 8 PM digest cron as a backstop.

const dhakaHM = (d = new Date()) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`)

export async function buildDailySummary(day = isoDay()) {
  const { start, end } = dayRange(day)
  const t = dayRange(isoDay(new Date(start.getTime() + 36 * 3600_000)))
  const s = await getSettings()
  const [visits, created, waiting, unassigned, tomorrow, claims] = await Promise.all([
    HomecareRequest.find({ deletedAt: null, scheduledAt: { $gte: start, $lt: end } }).select('status visit timeline returnTrip billing source services').lean<any[]>(),
    HomecareRequest.find({ deletedAt: null, 'timeline.requestedAt': { $gte: start, $lt: end } }).select('source').lean<any[]>(),
    HomecareRequest.countDocuments({ deletedAt: null, status: { $in: ['NEW', 'VERIFIED'] } }),
    HomecareRequest.countDocuments({ deletedAt: null, status: 'CONFIRMED', scheduledAt: { $gte: start } }),
    HomecareRequest.find({ deletedAt: null, status: { $nin: ['CANCELLED'] }, scheduledAt: { $gte: t.start, $lt: t.end } }).select('services').lean<any[]>(),
    ExpenseClaim.find({ submittedAt: { $gte: start, $lt: end } }).select('total').lean<any[]>(),
  ])
  const done = visits.filter((v) => ['COMPLETED', 'CLOSED'].includes(v.status))
  const cancelled = visits.filter((v) => v.status === 'CANCELLED').length
  const late = visits.filter((v) => (v.visit?.lateMin ?? 0) > s.sla.lateAfterMin).length
  const out = visits.filter((v) => v.timeline?.enRouteAt && v.returnTrip?.reachedAt).map((v) => Math.round((+new Date(v.returnTrip.reachedAt) - +new Date(v.timeline.enRouteAt)) / 60000))
  const billed = visits.reduce((a, v) => a + (v.billing?.invoiceAmount ?? 0), 0)
  const due = visits.filter((v) => (v.billing?.dueAmount ?? 0) > 0)
  const byService: Record<string, number> = {}
  for (const v of tomorrow) for (const x of v.services ?? []) byService[x.name] = (byService[x.name] ?? 0) + 1
  const dayLabel = new Date(`${day}T12:00:00+06:00`).toLocaleDateString('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short', day: 'numeric', month: 'short' })
  const lines = [
    `📋 Unico HomeCare · ${dayLabel}`,
    `Visits ${visits.length} · completed ${done.length} · cancelled ${cancelled} · late ${late}`,
    done.length ? `Avg visit ${hm(avg(done.map((v) => v.visit?.durationMin ?? 0)))}${out.length ? ` · avg time out ${hm(avg(out))}` : ''}` : '',
    `New requests ${created.length}${created.some((c) => c.source === 'WEBSITE') ? ` (website ${created.filter((c) => c.source === 'WEBSITE').length})` : ''} · waiting to confirm ${waiting} · unassigned ${unassigned}`,
    billed || due.length ? `Billed ${taka(billed)}${due.length ? ` · due ${taka(due.reduce((a, v) => a + v.billing.dueAmount, 0))} (${due.length} visit${due.length === 1 ? '' : 's'})` : ''}` : '',
    claims.length ? `Expense claims ${claims.length} · ${taka(claims.reduce((a, c) => a + (c.total ?? 0), 0))}` : '',
    `Tomorrow: ${tomorrow.length} visit${tomorrow.length === 1 ? '' : 's'} booked${Object.keys(byService).length ? ` (${Object.entries(byService).map(([k, n]) => `${k} ${n}`).join(', ')})` : ''}`,
  ].filter(Boolean)
  return lines.join('\n')
}

/** Who gets it: HODs (all active people), the visit-update numbers, and this card's own numbers. */
async function recipients() {
  const s = await getSettings()
  const cfg = s.dailyWhatsApp
  const out: { name: string; phone: string }[] = []
  if (cfg.toHods) for (const c of s.hodAlerts.contacts ?? []) if (c.active) out.push({ name: `${c.name} (${c.designation})`, phone: c.phone })
  if (cfg.toUpdateNumbers) for (const e of s.visitUpdates.extra ?? []) out.push({ name: e.name, phone: e.phone })
  for (const e of cfg.extra ?? []) out.push({ name: e.name, phone: e.phone })
  const seen = new Set<string>()
  return out.filter((x) => {
    const n = waNumber(x.phone)
    if (!n || seen.has(n)) return false
    seen.add(n)
    return true
  })
}

/** Send today's summary. `force` (Send now) skips the time check and the once-a-day guard. */
export async function sendDailySummary(opts: { force?: boolean; initiatedBy?: string } = {}) {
  const s = await getSettings()
  const cfg = s.dailyWhatsApp
  if (!opts.force && (!cfg.enabled || dhakaHM() < (cfg.time || '20:00'))) return { sent: 0, skipped: 'not yet' }
  if (!(await isPaired())) return { sent: 0, skipped: 'WhatsApp not paired' }
  const day = isoDay()
  if (!opts.force) {
    // claim today's send once, across instances (unique key)
    try {
      await Setting.create({ key: `dailyWhatsApp:sent:${day}`, value: { at: new Date() } })
    } catch {
      return { sent: 0, skipped: 'already sent' }
    }
  }
  const to = await recipients()
  if (!to.length) return { sent: 0, skipped: 'no recipients' }
  const summary = await buildDailySummary(day)
  const { text } = await renderTemplate('daily_summary', { summary })
  const { queueWhatsApp } = await import('../wa/service')
  for (const r of to) await queueWhatsApp({ to: r.phone, toName: r.name, text, templateKey: 'daily_summary', initiatedBy: opts.initiatedBy })
  return { sent: to.length }
}
