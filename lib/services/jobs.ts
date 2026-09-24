import 'server-only'
import { HomecareRequest, AssignmentLog, Notification, User } from '../models'
import { notifyRoles, notifyUsers, queueEmail } from '../messaging'
import { getSettings, ruleAllows } from '../settings'
import { audit } from '../audit'
import { dayRange, isoDay, date as fmtDate } from '../format'
import { rankCandidates } from './requests'

const g = globalThis as unknown as { _hcLastSweep?: number }

/**
 * Acceptance timeouts (ASSIGNED past respondBy → back to CONFIRMED + escalation) and
 * overdue alerts (not checked in 15 min after schedule). Cheap; safe to call often.
 * Runs from the cron route and opportunistically (max once a minute per instance) from boards.
 */
export async function sweep(force = false) {
  if (!force && g._hcLastSweep && Date.now() - g._hcLastSweep < 60_000) return { skipped: true }
  g._hcLastSweep = Date.now()
  const now = new Date()
  const s = await getSettings()
  let timeouts = 0
  let overdue = 0

  const expired = await HomecareRequest.find({ status: 'ASSIGNED', 'assignment.respondBy': { $lt: now }, deletedAt: null })
  for (const r of expired) {
    const staffId = r.assignment?.primaryStaffId
    r.status = 'CONFIRMED'
    r.assignment.declines.push({ staffId, reason: 'Timeout', note: `No response in ${s.sla.acceptTimeoutMin} min`, at: now })
    r.set('assignment.primaryStaffId', undefined)
    r.set('assignment.secondaryStaffIds', [])
    r.set('timeline.assignedAt', undefined)
    r.version = (r.version ?? 0) + 1
    await r.save()
    await AssignmentLog.create({ requestId: r._id, fromStaffId: staffId, action: 'TIMEOUT', reason: 'No response', by: undefined })
    await audit(null, 'request.accept_timeout', 'request', r._id, { after: { status: 'CONFIRMED', staffId: String(staffId) }, label: r.requestNo })
    const staff = staffId ? await User.findById(staffId).select('name').lean<any>() : null
    const next = (await rankCandidates(r, 3)).find((c) => c.id !== String(staffId))
    await notifyRoles(['HC_ADMIN'], {
      type: 'ESCALATION',
      title: `${r.requestNo} unaccepted after ${s.sla.acceptTimeoutMin} min`,
      body: `${staff?.name ?? 'Staff'} did not respond${next ? ` · next best: ${next.name}` : ''}`,
      requestId: r._id,
      url: `/requests/${r._id}?assign=1`,
      priority: 'high',
    })
    timeouts++
  }

  const lateCut = new Date(now.getTime() - 15 * 60_000)
  const late = await HomecareRequest.find({ status: { $in: ['ACCEPTED', 'EN_ROUTE'] }, scheduledAt: { $lt: lateCut, $gt: new Date(now.getTime() - 12 * 3600_000) }, deletedAt: null }).lean<any[]>()
  for (const r of late) {
    const already = await Notification.exists({ type: 'OVERDUE', 'data.requestId': r._id })
    if (already) continue
    const mins = Math.round((now.getTime() - new Date(r.scheduledAt).getTime()) / 60000)
    await notifyUsers([r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])], { type: 'OVERDUE', as: 'STAFF', title: `Check in overdue · ${r.requestNo}`, body: `${mins} min past the scheduled time`, requestId: r._id, url: `/m/visits/${r._id}`, priority: 'high' })
    await notifyRoles(['HC_ADMIN'], { type: 'OVERDUE', title: `${r.requestNo} overdue`, body: `Check-in ${mins} min past ${r.patientSnapshot?.name}`, requestId: r._id, url: `/requests/${r._id}`, priority: 'high' })
    overdue++
  }
  return { timeouts, overdue }
}

/** Reminders T-2h and T-30min to the assigned staff (in-app). */
export async function reminders() {
  const now = Date.now()
  let sent = 0
  for (const before of [120, 30]) {
    const from = new Date(now + (before - 5) * 60_000)
    const to = new Date(now + before * 60_000)
    const due = await HomecareRequest.find({ status: { $in: ['ASSIGNED', 'ACCEPTED'] }, scheduledAt: { $gte: from, $lt: to }, deletedAt: null }).lean<any[]>()
    for (const r of due) {
      await notifyUsers([r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])], { type: 'REMINDER', as: 'STAFF', title: `Visit in ${before === 120 ? '2 hours' : '30 min'} · ${r.patientSnapshot?.name}`, body: `${r.requestNo} · ${r.patientSnapshot?.area ?? ''}`, requestId: r._id, url: `/m/visits/${r._id}` })
      sent++
    }
  }
  return { sent }
}

/** Daily digest email 20:00 to HC_ADMIN and VIEWER. */
export async function dailyDigest() {
  const s = await getSettings()
  if (!s.email.dailyDigest) return { skipped: true }
  const { start, end } = dayRange(isoDay())
  const [created, completed, cancelled, open] = await Promise.all([
    HomecareRequest.countDocuments({ 'timeline.requestedAt': { $gte: start, $lt: end } }),
    HomecareRequest.find({ 'timeline.completedAt': { $gte: start, $lt: end } }).select('visit timeline').lean<any[]>(),
    HomecareRequest.countDocuments({ 'timeline.cancelledAt': { $gte: start, $lt: end } }),
    HomecareRequest.countDocuments({ status: { $in: ['NEW', 'VERIFIED', 'CONFIRMED', 'ASSIGNED'] } }),
  ])
  const onTime = completed.filter((r) => (r.visit?.lateMin ?? 0) <= s.sla.lateAfterMin).length
  const text = [
    `Today · ${fmtDate(new Date())}`,
    `New requests: ${created}`,
    `Completed visits: ${completed.length}`,
    `Cancelled: ${cancelled}`,
    `Still open: ${open}`,
    `On-time arrival: ${completed.length ? Math.round((onTime / completed.length) * 100) : 100}%`,
  ].join('\n')
  const digestRoles = ['HC_ADMIN', 'VIEWER'].filter((r) => ruleAllows(s.notificationRules, 'DAILY_DIGEST', r, 'email'))
  const admins = await User.find({ role: { $in: digestRoles }, status: 'ACTIVE', email: { $exists: true, $ne: null }, 'notificationPrefs.email': { $ne: false } }).select('email name').lean<any[]>()
  for (const a of admins) await queueEmail({ to: a.email, toName: a.name, subject: `Home care daily digest · ${fmtDate(new Date())}`, text, templateKey: 'admin_daily_digest', cta: { label: 'Open dashboard', url: `${process.env.APP_BASE_URL ?? ''}/dashboard` } })
  return { sent: admins.length }
}
