import 'server-only'
import { HomecareRequest } from '../models'
import { getSettings } from '../settings'
import { dayRange, isoDay, minutesBetween, time as fmtTime } from '../format'
import { rankCandidates, slaInfo, withPeople } from './requests'

/** "Sabina Akter" → "Sabina A." ; "Dr. Farida Rahman" → "Dr. Farida R." */
export function shortName(name?: string | null) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  const title = /^(Dr\.?|Md\.?|Mst\.?)$/i.test(parts[0]) ? parts.shift() + ' ' : ''
  if (parts.length < 2) return title + (parts[0] ?? '')
  return `${title}${parts[0]} ${parts[parts.length - 1][0]}.`
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)

/** Start of the current week in Dhaka (weeks start on Saturday, as the hospital rota does). */
function weekStart() {
  const today = isoDay()
  const { start } = dayRange(today)
  const dow = new Date(`${today}T12:00:00+06:00`).getUTCDay() // 0 Sun … 6 Sat
  const back = (dow + 1) % 7 // days since Saturday
  return new Date(start.getTime() - back * 86400_000)
}

export type Escalation = {
  id: string
  requestNo: string
  kind: 'overdue' | 'accept' | 'urgent'
  title: string
  sub: string
  /** live countdown target (accept / urgent) */
  dueAt?: string | null
  subAfter?: string
  action: 'open' | 'reassign'
}

export async function dashboardData() {
  const s = await getSettings()
  const now = Date.now()
  const open = await HomecareRequest.find({ status: { $in: ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS', 'COMPLETED'] }, deletedAt: null })
    .select('requestNo status priority patientSnapshot services scheduledAt slot expectedDurationMin timeline assignment')
    .sort({ scheduledAt: 1 })
    .lean<any[]>()
  await withPeople(open)
  const by = (...st: string[]) => open.filter((r) => st.includes(r.status))

  // ---------------------------------------------------------------- KPI tiles
  const fresh = by('NEW', 'VERIFIED')
  const confirmed = by('CONFIRMED', 'RESCHEDULED')
  const assigned = by('ASSIGNED', 'ACCEPTED')
  const awaiting = by('ASSIGNED').sort((a, b) => +new Date(a.assignment?.respondBy ?? 0) - +new Date(b.assignment?.respondBy ?? 0))
  const inProg = by('IN_PROGRESS')
  const active = by('EN_ROUTE', 'IN_PROGRESS')
  const completed = by('COMPLETED')
  const overdue = by('ACCEPTED', 'EN_ROUTE')
    .filter((r) => r.scheduledAt && now - new Date(r.scheduledAt).getTime() > s.sla.lateAfterMin * 60_000)
    .map((r) => ({ r, late: Math.round((now - new Date(r.scheduledAt).getTime()) / 60000) }))
    .sort((a, b) => b.late - a.late)
  const confirmToday = confirmed.filter((r) => r.scheduledAt && isoDay(r.scheduledAt) === isoDay()).length
  const avgElapsed = avg(inProg.filter((r) => r.timeline?.checkInAt).map((r) => (now - new Date(r.timeline.checkInAt).getTime()) / 60000))

  const kpis = {
    fresh: { n: fresh.length, sub: `${fresh.filter((r) => r.priority !== 'ROUTINE').length} urgent` },
    confirmed: { n: confirmed.length, sub: confirmed.length ? `unassigned${confirmToday ? ` · ${confirmToday} today` : ''}` : 'none waiting' },
    assigned: { n: assigned.length, sub: `${awaiting.length} awaiting accept` },
    inProgress: { n: active.length, sub: inProg.length ? `avg ${avgElapsed} min elapsed` : `${active.length - inProg.length} en route` },
    completed: { n: completed.length, sub: completed.length ? 'awaiting invoice & close' : 'all closed' },
    overdue: { n: overdue.length, sub: overdue[0] ? `${overdue[0].r.requestNo.replace(/^HC-\d+-/, 'HC-…-')} +${overdue[0].late} min` : 'none' },
    awaiting: { n: awaiting.length, dueAt: awaiting[0]?.assignment?.respondBy ? new Date(awaiting[0].assignment.respondBy).toISOString() : null },
  }

  // ---------------------------------------------------------------- 14-day trend + SLA metrics
  const days = Array.from({ length: 14 }, (_, i) => isoDay(now - (13 - i) * 86400_000))
  const from = dayRange(days[0]).start
  const window = await HomecareRequest.find({ deletedAt: null, $or: [{ 'timeline.requestedAt': { $gte: from } }, { 'timeline.checkInAt': { $gte: from } }, { 'timeline.completedAt': { $gte: from } }] })
    .select('timeline visit.lateMin visit.durationMin expectedDurationMin scheduledAt')
    .lean<any[]>()
  const perDay = days.map((d) => window.filter((r) => r.timeline?.requestedAt && isoDay(r.timeline.requestedAt) === d).length)
  const total = perDay.reduce((a, b) => a + b, 0)

  const response = avg(
    window.filter((r) => r.timeline?.requestedAt >= from && r.timeline?.confirmedAt).map((r) => minutesBetween(r.timeline.requestedAt, r.timeline.confirmedAt)!).filter((m) => m >= 0),
  )
  const assignment = avg(
    window
      .filter((r) => r.timeline?.confirmedAt >= from && r.timeline?.assignedAt)
      // Visits booked for a later day are assigned later on purpose; the assignment SLA only applies within 24 h
      .filter((r) => !r.scheduledAt || new Date(r.scheduledAt).getTime() - new Date(r.timeline.confirmedAt).getTime() <= 24 * 3600_000)
      .map((r) => minutesBetween(r.timeline.confirmedAt, r.timeline.assignedAt)!)
      .filter((m) => m >= 0),
  )
  const arrived = window.filter((r) => r.timeline?.checkInAt >= from)
  const onTime = arrived.length ? Math.round((arrived.filter((r) => (r.visit?.lateMin ?? 0) <= s.sla.lateAfterMin).length / arrived.length) * 100) : null
  const visits = window.filter((r) => r.timeline?.completedAt >= from && r.visit?.durationMin != null)
  const visitAvg = avg(visits.map((r) => r.visit.durationMin))
  const planned = avg(visits.map((r) => r.expectedDurationMin ?? 45)) ?? 45

  const metrics = [
    { label: 'Avg response', value: response != null ? `${response} min` : '—', target: `target ≤ ${s.sla.confirmRoutineMin}`, bad: response != null && response > s.sla.confirmRoutineMin },
    { label: 'Avg assignment', value: assignment != null ? `${assignment} min` : '—', target: `target ≤ ${s.sla.assignMin}`, bad: assignment != null && assignment > s.sla.assignMin },
    { label: 'On-time arrival', value: onTime != null ? `${onTime}%` : '—', target: 'target ≥ 90%', bad: onTime != null && onTime < 90 },
    { label: 'Avg visit', value: visitAvg != null ? `${visitAvg} min` : '—', target: `target ${planned} planned`, bad: visitAvg != null && visitAvg > planned * (1 + s.sla.overtimePct / 100) },
  ]

  // ---------------------------------------------------------------- live panel
  const live = active
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'IN_PROGRESS' ? -1 : 1))
    .map((r) => ({
      id: String(r._id),
      patient: r.patientSnapshot?.name ?? '',
      line: [r.services?.[0]?.name, shortName(r.primaryStaff?.name)].filter(Boolean).join(' · '),
      status: r.status as string,
      checkInAt: r.timeline?.checkInAt ? new Date(r.timeline.checkInAt).toISOString() : null,
      planned: r.expectedDurationMin ?? 45,
      eta: r.scheduledAt ? fmtTime(r.scheduledAt) : null,
      over: r.timeline?.checkInAt ? (now - new Date(r.timeline.checkInAt).getTime()) / 60000 > (r.expectedDurationMin ?? 45) : false,
    }))

  // ---------------------------------------------------------------- escalations
  const esc: Escalation[] = []
  for (const { r, late } of overdue)
    esc.push({
      id: String(r._id),
      requestNo: r.requestNo,
      kind: 'overdue',
      title: `${r.requestNo} overdue`,
      sub: `Check-in ${late} min past ${fmtTime(r.scheduledAt)}${r.primaryStaff ? ` · ${shortName(r.primaryStaff.name)}` : ''}`,
      action: 'open',
    })
  for (const r of awaiting.slice(0, 4)) {
    const next = (await rankCandidates(r, 3).catch(() => [])).find((c) => c.id !== String(r.assignment?.primaryStaffId))
    esc.push({
      id: String(r._id),
      requestNo: r.requestNo,
      kind: 'accept',
      title: `${r.requestNo} awaiting accept`,
      sub: `${shortName(r.primaryStaff?.name) || 'Staff'} · `,
      dueAt: r.assignment?.respondBy ? new Date(r.assignment.respondBy).toISOString() : null,
      subAfter: ` left${next ? ` · next: ${shortName(next.name)}` : ''}`,
      action: 'reassign',
    })
  }
  for (const r of fresh.filter((x) => x.priority !== 'ROUTINE')) {
    const sla = slaInfo(r, s)
    esc.push({
      id: String(r._id),
      requestNo: r.requestNo,
      kind: 'urgent',
      title: `${r.requestNo} ${r.priority.toLowerCase()}, unconfirmed`,
      sub: `${r.patientSnapshot?.name ?? ''} · confirm in `,
      dueAt: sla?.dueAt ? new Date(sla.dueAt).toISOString() : null,
      action: 'open',
    })
  }

  // ---------------------------------------------------------------- service mix & zones
  const ws = weekStart()
  const { start: todayStart } = dayRange()
  const [svcWeek, svcToday, zonesWeek, zonesToday] = await Promise.all([
    serviceMix(ws),
    serviceMix(todayStart),
    zoneMix(ws),
    zoneMix(todayStart),
  ])

  return { kpis, trend: { days, perDay, total, avg: Math.round((total / 14) * 10) / 10 }, metrics, live, escalations: esc, svcWeek, svcToday, zonesWeek, zonesToday }
}

async function serviceMix(since: Date): Promise<[string, number][]> {
  const rows = await HomecareRequest.aggregate([
    { $match: { deletedAt: null, 'timeline.completedAt': { $gte: since } } },
    { $unwind: '$services' },
    { $group: { _id: '$services.name', n: { $sum: 1 } } },
    { $sort: { n: -1, _id: 1 } },
    { $limit: 6 },
  ])
  return rows.map((r) => [r._id ?? 'Other', r.n])
}

async function zoneMix(since: Date): Promise<[string, number][]> {
  const rows = await HomecareRequest.aggregate([
    { $match: { deletedAt: null, 'timeline.requestedAt': { $gte: since }, status: { $ne: 'CANCELLED' } } },
    { $group: { _id: '$patientSnapshot.area', n: { $sum: 1 } } },
    { $sort: { n: -1, _id: 1 } },
    { $limit: 5 },
  ])
  return rows.map((r) => [r._id || 'Unspecified', r.n])
}
