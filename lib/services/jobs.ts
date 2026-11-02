import 'server-only'
import { HomecareRequest, AssignmentLog, Notification, User, Attachment, MessageLog } from '../models'
import { notifyRoles, notifyUsers, queueEmail } from '../messaging'
import { getSettings, ruleAllows } from '../settings'
import { audit } from '../audit'
import { dayRange, isoDay, date as fmtDate } from '../format'
import { rankCandidates } from './requests'
import { deleteBlob } from '../storage'
import { shortLink } from '../links'

const g = globalThis as unknown as { _hcLastSweep?: number }

/**
 * Acceptance timeouts (ASSIGNED past respondBy → back to CONFIRMED + escalation) and
 * overdue alerts (not checked in 15 min after schedule). Cheap; safe to call often.
 * Runs from the cron route and opportunistically (max once a minute per instance) from boards.
 */
/** Public-form uploads that never became part of a request (abandoned bookings): delete after 24 h. */
export async function cleanupPendingUploads() {
  const rows = await Attachment.find({ requestId: null, 'pending.at': { $lt: new Date(Date.now() - 86400_000) }, deletedAt: null }).select('+blobUrl').lean<any[]>()
  for (const a of rows) {
    if (a.blobUrl) await deleteBlob(a.blobUrl)
    await Attachment.deleteOne({ _id: a._id })
  }
  return rows.length
}

export async function sweep(force = false) {
  if (!force && g._hcLastSweep && Date.now() - g._hcLastSweep < 60_000) return { skipped: true }
  g._hcLastSweep = Date.now()
  const now = new Date()
  const s = await getSettings()
  let timeouts = 0
  let overdue = 0

  const expired = await HomecareRequest.find({ status: 'ASSIGNED', 'assignment.respondBy': { $lt: now }, 'assignment.timedOutAt': null, deletedAt: null })
  for (const r of expired) {
    const staffId = r.assignment?.primaryStaffId
    if (s.sla.onAcceptTimeout !== 'REMOVE') {
      // keep the staff on the visit and ask the coordinator — nobody is taken off without a click
      const claimed = await HomecareRequest.updateOne({ _id: r._id, 'assignment.timedOutAt': null }, { $set: { 'assignment.timedOutAt': now } })
      if (!claimed.modifiedCount) continue
      await AssignmentLog.create({ requestId: r._id, fromStaffId: staffId, action: 'TIMEOUT', reason: 'No response — waiting for coordinator', by: undefined })
      await audit(null, 'request.accept_timeout', 'request', r._id, { after: { status: 'ASSIGNED', staffId: String(staffId), waiting: true }, label: r.requestNo })
      const staff = staffId ? await User.findById(staffId).select('name').lean<any>() : null
      await notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], {
        type: 'ESCALATION',
        title: `${staff?.name ?? 'Staff'} hasn't accepted ${r.requestNo}`,
        body: `${s.sla.acceptTimeoutMin} min passed · keep waiting, accept for them or reassign`,
        requestId: r._id,
        url: `/requests/${r._id}`,
        priority: 'high',
      })
      if (staffId) await notifyUsers([staffId], { type: 'ASSIGNED', as: 'STAFF', title: `Please accept or decline ${r.requestNo}`, body: `${r.patientSnapshot?.name ?? ''} · the coordinator is waiting for your answer`, requestId: r._id, url: `/m/visits/${r._id}`, priority: 'high' })
      const { visitAlert } = await import('./hod')
      await visitAlert('NO_RESPONSE', r._id, { staffName: staff?.name, minutes: s.sla.acceptTimeoutMin })
      timeouts++
      continue
    }
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

  // live tracking: tell the coordinators once when a travelling phone goes silent for 3 min
  let lost = 0
  const silent = await HomecareRequest.find({ 'tracking.active': true, 'tracking.lostNotifiedAt': null, $or: [{ 'tracking.at': { $lt: new Date(now.getTime() - 3 * 60_000) } }, { 'tracking.at': null, 'tracking.startedAt': { $lt: new Date(now.getTime() - 3 * 60_000) } }] })
    .select('requestNo patientSnapshot tracking')
    .lean<any[]>()
  for (const r of silent) {
    await HomecareRequest.updateOne({ _id: r._id }, { $set: { 'tracking.lostNotifiedAt': now } })
    const who = r.tracking?.userId ? await User.findById(r.tracking.userId).select('name').lean<any>() : null
    await notifyRoles(['HC_ADMIN'], { type: 'OVERDUE', title: `Live location lost · ${r.requestNo}`, body: `${who?.name ?? 'Staff'} ${r.tracking?.phase === 'RETURN' ? 'returning to the hospital' : `on the way to ${r.patientSnapshot?.name}`} — no location for 3+ min`, requestId: r._id, url: `/requests/${r._id}` })
    lost++
  }
  // ways back still open after 4 h: closed without an arrival time
  const { finishReturn } = await import('./tracking')
  const stale = await HomecareRequest.find({ 'tracking.active': true, 'tracking.phase': 'RETURN', 'returnTrip.startedAt': { $lt: new Date(now.getTime() - 4 * 3600_000) } }).select('_id').lean<any[]>()
  for (const r of stale) await finishReturn(r._id, 'timeout')
  // WhatsApp heartbeat: messages held back by the sending limits or quiet hours go out on a later sweep
  // (only for messages waiting 2+ min — fresh ones are already being sent by their own trigger)
  if (await MessageLog.exists({ channel: 'WHATSAPP', provider: 'wa_baileys', status: 'QUEUED', at: { $lt: new Date(now.getTime() - 120_000) } })) {
    const { pumpWhatsApp } = await import('../wa/service')
    await pumpWhatsApp().catch(() => {})
  }
  // daily WhatsApp summary: sent once, at the first sweep after the chosen time
  const { sendDailySummary } = await import('./daily')
  const daily = await sendDailySummary().catch((e) => ({ sent: 0, skipped: String(e?.message ?? e) }))
  return { timeouts, overdue, lost, returnsClosed: stale.length, daily }
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
  // backstop for the WhatsApp summary (8 PM cron) in case nobody used the app after the chosen time
  const { sendDailySummary } = await import('./daily')
  await sendDailySummary().catch((e) => console.error('[daily summary]', e))
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
  const admins = await User.find({ $or: [{ role: { $in: digestRoles } }, { roles: { $in: digestRoles } }], status: 'ACTIVE', email: { $exists: true, $ne: null }, 'notificationPrefs.email': { $ne: false } }).select('email name').lean<any[]>()
  const url = admins.length ? await shortLink('/dashboard', { kind: 'DASHBOARD' }) : ''
  for (const a of admins) await queueEmail({ to: a.email, toName: a.name, subject: `Home care daily digest · ${fmtDate(new Date())}`, text, templateKey: 'admin_daily_digest', cta: { label: 'Open dashboard', url } })
  return { sent: admins.length }
}
