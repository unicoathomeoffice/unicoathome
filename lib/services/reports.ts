import 'server-only'
import { HomecareRequest, User, Designation, MessageLog } from '../models'
import { getSettings } from '../settings'
import { dayRange, isoDay } from '../format'
import { withPeople } from './requests'
import { TZ, TRANSPORT_MODE_LABEL, PAYMENT_METHOD_LABEL, STATUS_LABEL, type Status } from '../constants'

// W14 Reports: every number is a Mongo aggregation over homecare_requests in the chosen window
// (window = timeline.requestedAt, Asia/Dhaka days). Timing metrics follow plan §4.3.

export type GroupBy = 'day' | 'staff' | 'service' | 'zone'
export type ReportFilter = { from: string; to: string; groupBy?: GroupBy; service?: string; zone?: string }

export function defaultRange() {
  const to = isoDay()
  const from = isoDay(Date.now() - 13 * 86400_000)
  return { from, to }
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
export function normaliseFilter(p: { from?: string | null; to?: string | null; groupBy?: string | null; service?: string | null; zone?: string | null }): Required<Pick<ReportFilter, 'from' | 'to' | 'groupBy'>> & ReportFilter {
  const d = defaultRange()
  let from = p.from && YMD.test(p.from) ? p.from : d.from
  let to = p.to && YMD.test(p.to) ? p.to : d.to
  if (from > to) [from, to] = [to, from]
  const groupBy = (['day', 'staff', 'service', 'zone'] as const).includes(p.groupBy as GroupBy) ? (p.groupBy as GroupBy) : 'day'
  return { from, to, groupBy, service: p.service || undefined, zone: p.zone || undefined }
}

function match(f: ReportFilter) {
  const m: Record<string, any> = { deletedAt: null, 'timeline.requestedAt': { $gte: dayRange(f.from).start, $lt: dayRange(f.to).end } }
  if (f.service) m['services.code'] = f.service
  if (f.zone) m['patientSnapshot.area'] = f.zone
  return m
}

const MIN = 60000
/** `$ifNull` turns a missing field into null so comparisons with null behave. */
const nn = (x: unknown) => ({ $ifNull: [x, null] })
const has = (x: unknown) => ({ $ne: [nn(x), null] })
const minutes = (a: unknown, b: unknown) => ({ $cond: [{ $and: [has(a), has(b)] }, { $divide: [{ $subtract: [b, a] }, MIN] }, null] })
const pct = (ok: number, n: number) => (n ? Math.round((ok / n) * 100) : null)
const round = (v: number | null | undefined) => (v == null ? null : Math.round(v))
const DONE = ['COMPLETED', 'CLOSED']

/** Derived per-request fields shared by all facets. */
function derive(sla: Awaited<ReturnType<typeof getSettings>>['sla']) {
  return [
    {
      $addFields: {
        _done: { $in: ['$status', DONE] },
        _resp: minutes('$timeline.requestedAt', '$timeline.confirmedAt'),
        _assign: minutes('$timeline.confirmedAt', { $ifNull: ['$assignment.assignedAt', '$timeline.assignedAt'] }),
        _accept: minutes({ $ifNull: ['$assignment.assignedAt', '$timeline.assignedAt'] }, { $ifNull: ['$assignment.acceptedAt', '$timeline.acceptedAt'] }),
        _late: minutes('$scheduledAt', '$timeline.checkInAt'),
        _dur: { $ifNull: ['$visit.durationMin', minutes('$timeline.checkInAt', '$timeline.checkOutAt')] },
        _turn: minutes('$timeline.requestedAt', '$timeline.completedAt'),
        _lag: minutes('$timeline.completedAt', '$timeline.closedAt'),
        _respTarget: { $switch: { branches: [{ case: { $eq: ['$priority', 'URGENT'] }, then: sla.confirmUrgentMin }, { case: { $eq: ['$priority', 'EMERGENCY'] }, then: 2 }], default: sla.confirmRoutineMin } },
        _team: { $filter: { input: { $concatArrays: [['$assignment.primaryStaffId'], { $ifNull: ['$assignment.secondaryStaffIds', []] }] }, cond: { $ne: ['$$this', null] } } },
        _day: { $dateToString: { date: '$timeline.requestedAt', format: '%Y-%m-%d', timezone: TZ } },
        _completedDay: { $dateToString: { date: '$timeline.completedAt', format: '%Y-%m-%d', timezone: TZ } },
        _closedDay: { $dateToString: { date: '$timeline.closedAt', format: '%Y-%m-%d', timezone: TZ } },
        _bill: { $ifNull: ['$billing.billAmount', '$billing.invoiceAmount'] },
        _declines: { $size: { $ifNull: ['$assignment.declines', []] } },
      },
    },
    {
      $addFields: {
        _respOk: { $cond: [{ $eq: ['$_resp', null] }, null, { $lte: ['$_resp', '$_respTarget'] }] },
        _assignOk: { $cond: [{ $eq: ['$_assign', null] }, null, { $lte: ['$_assign', sla.assignMin] }] },
        _acceptOk: { $cond: [{ $eq: ['$_accept', null] }, null, { $lte: ['$_accept', sla.acceptTimeoutMin] }] },
        _onTime: { $cond: [{ $eq: ['$_late', null] }, null, { $lte: ['$_late', sla.lateAfterMin] }] },
        _sameDay: { $cond: [{ $not: [has('$timeline.closedAt')] }, null, { $eq: ['$_completedDay', '$_closedDay'] }] },
        _overtime: { $gt: [{ $ifNull: ['$visit.overtimeMin', 0] }, 0] },
      },
    },
  ]
}

const cnt = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } })
const okN = (field: string) => ({ ok: cnt({ $eq: [field, true] }), n: cnt({ $ne: [field, null] }) })

/** Metrics produced for every breakdown row (and the totals). */
function rowGroup(id: unknown) {
  const [r, a, c, t] = [okN('$_respOk'), okN('$_assignOk'), okN('$_acceptOk'), okN('$_onTime')]
  return {
    _id: id,
    n: { $sum: 1 },
    completed: cnt('$_done'),
    cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }),
    avgResp: { $avg: '$_resp' },
    avgAssign: { $avg: '$_assign' },
    avgAccept: { $avg: '$_accept' },
    avgLate: { $avg: '$_late' },
    avgDur: { $avg: '$_dur' },
    avgTurn: { $avg: '$_turn' },
    avgLag: { $avg: '$_lag' },
    respOk: r.ok,
    respN: r.n,
    assignOk: a.ok,
    assignN: a.n,
    acceptOk: c.ok,
    acceptN: c.n,
    onTimeOk: t.ok,
    onTimeN: t.n,
    sameDayOk: cnt({ $eq: ['$_sameDay', true] }),
    sameDayN: cnt({ $ne: ['$_sameDay', null] }),
    overtime: cnt('$_overtime'),
    declines: { $sum: '$_declines' },
    billed: { $sum: { $ifNull: ['$_bill', 0] } },
    paid: { $sum: { $cond: [{ $eq: ['$billing.status', 'PAID'] }, { $ifNull: ['$_bill', 0] }, 0] } },
    due: { $sum: { $cond: [{ $eq: ['$billing.status', 'DUE'] }, { $ifNull: ['$_bill', 0] }, 0] } },
    ratingAvg: { $avg: '$feedback.rating' },
    ratingN: cnt(has('$feedback.rating')),
  }
}

function shapeRow(x: any) {
  return {
    n: x.n ?? 0,
    completed: x.completed ?? 0,
    cancelled: x.cancelled ?? 0,
    completionPct: pct(x.completed ?? 0, (x.n ?? 0) - (x.cancelled ?? 0)),
    avgResp: round(x.avgResp),
    avgAssign: round(x.avgAssign),
    avgAccept: round(x.avgAccept),
    avgLate: round(x.avgLate),
    avgDur: round(x.avgDur),
    avgTurn: round(x.avgTurn),
    avgLag: round(x.avgLag),
    respPct: pct(x.respOk, x.respN),
    assignPct: pct(x.assignOk, x.assignN),
    acceptPct: pct(x.acceptOk, x.acceptN),
    onTimePct: pct(x.onTimeOk, x.onTimeN),
    sameDayPct: pct(x.sameDayOk, x.sameDayN),
    overtime: x.overtime ?? 0,
    declines: x.declines ?? 0,
    billed: x.billed ?? 0,
    paid: x.paid ?? 0,
    due: x.due ?? 0,
    rating: x.ratingAvg == null ? null : Math.round(x.ratingAvg * 10) / 10,
    ratingN: x.ratingN ?? 0,
  }
}
export type ReportRow = ReturnType<typeof shapeRow>

function breakdownStages(groupBy: GroupBy): any[] {
  if (groupBy === 'day') return [{ $group: rowGroup('$_day') }, { $sort: { _id: 1 } }]
  if (groupBy === 'zone') return [{ $group: rowGroup({ $ifNull: ['$patientSnapshot.area', 'Unknown'] }) }, { $sort: { n: -1 } }]
  if (groupBy === 'service') return [{ $unwind: '$services' }, { $group: rowGroup({ $ifNull: ['$services.name', 'Other'] }) }, { $sort: { n: -1 } }]
  return [{ $unwind: '$_team' }, { $group: rowGroup('$_team') }, { $sort: { completed: -1, n: -1 } }]
}

export async function getReport(input: ReportFilter) {
  const f = normaliseFilter(input)
  const s = await getSettings()
  const m = match(f)
  const days = Math.round((dayRange(f.to).end.getTime() - dayRange(f.from).start.getTime()) / 86400_000)
  const prevEnd = dayRange(f.from).start
  const prevStart = new Date(prevEnd.getTime() - days * 86400_000)

  const [agg] = await HomecareRequest.aggregate([
    { $match: m },
    ...derive(s.sla),
    {
      $facet: {
        totals: [{ $group: rowGroup(null) }],
        breakdown: breakdownStages(f.groupBy),
        volume: [{ $group: { _id: '$_day', n: { $sum: 1 }, completed: cnt('$_done'), cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }) } }, { $sort: { _id: 1 } }],
        staff: [{ $unwind: '$_team' }, { $group: rowGroup('$_team') }],
        staffDeclines: [{ $unwind: '$assignment.declines' }, { $group: { _id: '$assignment.declines.staffId', n: { $sum: 1 } } }],
        declineReasons: [{ $unwind: '$assignment.declines' }, { $group: { _id: { $ifNull: ['$assignment.declines.reason', 'Other'] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        services: [{ $unwind: '$services' }, { $group: { _id: { $ifNull: ['$services.name', 'Other'] }, n: { $sum: 1 }, completed: cnt('$_done') } }, { $sort: { n: -1 } }],
        zones: [{ $group: { _id: { $ifNull: ['$patientSnapshot.area', 'Unknown'] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        statuses: [{ $group: { _id: '$status', n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        priorities: [{ $group: { _id: '$priority', n: { $sum: 1 } } }],
        methods: [{ $match: { '_bill': { $gt: 0 } } }, { $group: { _id: { $ifNull: ['$billing.method', 'NONE'] }, n: { $sum: 1 }, amount: { $sum: '$_bill' } } }, { $sort: { amount: -1 } }],
        invoices: [
          { $match: { _done: true } },
          { $group: { _id: null, printed: cnt({ $eq: ['$billing.invoicePrinted', true] }), notPrinted: cnt({ $ne: ['$billing.invoicePrinted', true] }), withInvoiceNo: cnt(has('$billing.invoiceNo')), unbilled: cnt({ $not: [{ $gt: ['$_bill', 0] }] }) } },
        ],
        transport: [{ $match: { _done: true } }, { $group: { _id: { $ifNull: ['$transport.mode', 'NONE'] }, n: { $sum: 1 } } }, { $sort: { n: -1 } }],
        petty: [{ $unwind: '$pettyCash' }, { $group: { _id: '$pettyCash.status', n: { $sum: 1 }, amount: { $sum: { $ifNull: ['$pettyCash.amount', 0] } } } }],
      },
    },
  ])
  const prevCount = await HomecareRequest.countDocuments({ ...m, 'timeline.requestedAt': { $gte: prevStart, $lt: prevEnd } })

  // names for staff ids
  const staffIds = [...new Set([...agg.staff.map((x: any) => String(x._id)), ...agg.staffDeclines.map((x: any) => String(x._id)), ...(f.groupBy === 'staff' ? agg.breakdown.map((x: any) => String(x._id)) : [])])].filter((x) => x && x !== 'null')
  const users = await User.find({ _id: { $in: staffIds } }).select('name role employeeId designationId').lean<any[]>()
  const desigs = await Designation.find({ _id: { $in: users.map((u) => u.designationId).filter(Boolean) } }).select('title').lean<any[]>()
  const who = (id: unknown) => {
    const u = users.find((x) => String(x._id) === String(id))
    return { id: String(id), name: u?.name ?? 'Unknown staff', role: u?.role, employeeId: u?.employeeId, designation: desigs.find((d) => String(d._id) === String(u?.designationId))?.title }
  }

  // fill the per-day volume series (zero days included)
  const volMap = new Map(agg.volume.map((v: any) => [v._id, v]))
  const volume: { day: string; n: number; completed: number; cancelled: number }[] = []
  for (let t = dayRange(f.from).start.getTime(); t < dayRange(f.to).end.getTime(); t += 86400_000) {
    const k = isoDay(t + 6 * 3600_000)
    const v: any = volMap.get(k)
    volume.push({ day: k, n: v?.n ?? 0, completed: v?.completed ?? 0, cancelled: v?.cancelled ?? 0 })
  }

  const declineByStaff = new Map(agg.staffDeclines.map((x: any) => [String(x._id), x.n as number]))
  const staff = agg.staff
    .map((x: any) => ({ ...who(x._id), ...shapeRow(x), declines: declineByStaff.get(String(x._id)) ?? 0 }))
    .concat(
      // staff who only declined in the window
      [...declineByStaff.keys()].filter((id) => !agg.staff.some((x: any) => String(x._id) === id)).map((id) => ({ ...who(id), ...shapeRow({}), declines: declineByStaff.get(id) ?? 0 })),
    )
    .sort((a: any, b: any) => b.completed - a.completed || b.n - a.n)

  const label = (k: unknown) => {
    if (f.groupBy === 'staff') return who(k).name
    return String(k ?? '—')
  }
  const inv = agg.invoices[0] ?? { printed: 0, notPrinted: 0, withInvoiceNo: 0, unbilled: 0 }
  const pettyBy = (st: string) => agg.petty.find((p: any) => p._id === st) ?? { n: 0, amount: 0 }
  const totals = shapeRow(agg.totals[0] ?? {})
  const timeouts = agg.declineReasons.find((d: any) => d._id === 'Timeout')?.n ?? 0

  return {
    filter: f,
    days,
    sla: s.sla,
    totals,
    prevCount,
    changePct: prevCount ? Math.round(((totals.n - prevCount) / prevCount) * 100) : null,
    timeouts,
    declines: totals.declines - timeouts,
    declineReasons: agg.declineReasons.map((d: any) => ({ reason: d._id as string, n: d.n as number })),
    volume,
    breakdown: agg.breakdown.map((x: any) => ({ key: String(x._id), label: label(x._id), ...shapeRow(x) })),
    staff,
    services: agg.services.map((x: any) => ({ name: x._id as string, n: x.n as number, completed: x.completed as number })),
    zones: agg.zones.map((x: any) => ({ name: x._id as string, n: x.n as number })),
    statuses: agg.statuses.map((x: any) => ({ status: x._id as string, label: STATUS_LABEL[x._id as Status] ?? x._id, n: x.n as number })),
    priorities: Object.fromEntries(agg.priorities.map((x: any) => [x._id, x.n])) as Record<string, number>,
    revenue: {
      billed: totals.billed,
      paid: totals.paid,
      due: totals.due,
      methods: agg.methods.map((x: any) => ({ method: x._id as string, label: (PAYMENT_METHOD_LABEL as any)[x._id] ?? 'Not recorded', n: x.n as number, amount: x.amount as number })),
      invoicePrinted: inv.printed as number,
      invoiceNotPrinted: inv.notPrinted as number,
      unbilled: inv.unbilled as number,
    },
    transport: agg.transport.map((x: any) => ({ mode: x._id as string, label: (TRANSPORT_MODE_LABEL as any)[x._id] ?? 'Not recorded', n: x.n as number })),
    petty: {
      approved: pettyBy('APPROVED'),
      pending: pettyBy('PENDING'),
      rejected: pettyBy('REJECTED'),
    },
  }
}
export type Report = Awaited<ReturnType<typeof getReport>>

// ---------------------------------------------------------------- CSV exports
const esc = (v: unknown) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const fDT = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const dt = (v: unknown) => (v ? fDT.format(new Date(v as string)).replace(',', '') : '')
const mins = (a: unknown, b: unknown) => (a && b ? Math.round((new Date(b as string).getTime() - new Date(a as string).getTime()) / MIN) : '')

export function toCsv(head: string[], rows: unknown[][]) {
  // BOM so Excel opens UTF-8 (৳, names) correctly
  return '﻿' + [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\r\n')
}

/** One row per request, flattened (patient, services, team, times, durations, bill, invoice, transport). */
export async function requestsCsv(input: ReportFilter) {
  const f = normaliseFilter(input)
  const rows = await withPeople(await HomecareRequest.find(match(f)).sort({ 'timeline.requestedAt': 1 }).lean<any[]>())
  const head = [
    'Request no', 'Status', 'Priority', 'Source', 'Requested at', 'Patient', 'UHID', 'Phone', 'Age', 'Gender', 'Zone', 'Address',
    'Services', 'Tests / procedures', 'Primary staff', 'Team', 'Driver', 'Vehicle', 'Scheduled at', 'Slot',
    'Confirmed at', 'Assigned at', 'Accepted at', 'En route at', 'Check-in at', 'Check-out at', 'Completed at', 'Closed at', 'Cancelled at',
    'Response (min)', 'Assignment (min)', 'Acceptance (min)', 'Late (min)', 'Visit duration (min)', 'Turnaround (min)', 'Report lag (min)',
    'Declines', 'Bill amount', 'Billing status', 'Payment method', 'Invoice no', 'Invoice amount', 'Invoice printed',
    'Transport mode', 'Petty cash approved', 'Rating', 'Feedback', 'Cancel reason',
  ]
  const data = rows.map((r) => {
    const t = r.timeline ?? {}
    const assignedAt = r.assignment?.assignedAt ?? t.assignedAt
    const acceptedAt = r.assignment?.acceptedAt ?? t.acceptedAt
    return [
      r.requestNo, STATUS_LABEL[r.status as Status] ?? r.status, r.priority, r.source, dt(t.requestedAt),
      r.patientSnapshot?.name, r.patientSnapshot?.uhid, r.patientSnapshot?.phone, r.patientSnapshot?.ageYears, r.patientSnapshot?.gender, r.patientSnapshot?.area, r.patientSnapshot?.address,
      (r.services ?? []).map((x: any) => x.name).join('; '), (r.tests ?? []).join('; '),
      r.primaryStaff?.name, [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((p: any) => p.name).join('; '),
      r.driver?.name, r.vehicle ? `${r.vehicle.name ?? ''} ${r.vehicle.plate ?? ''}`.trim() : '', dt(r.scheduledAt), r.slot ?? r.preferred?.slot,
      dt(t.confirmedAt), dt(assignedAt), dt(acceptedAt), dt(t.enRouteAt), dt(t.checkInAt), dt(t.checkOutAt), dt(t.completedAt), dt(t.closedAt), dt(t.cancelledAt),
      mins(t.requestedAt, t.confirmedAt), mins(t.confirmedAt, assignedAt), mins(assignedAt, acceptedAt), mins(r.scheduledAt, t.checkInAt),
      r.visit?.durationMin ?? mins(t.checkInAt, t.checkOutAt), mins(t.requestedAt, t.completedAt), mins(t.completedAt, t.closedAt),
      (r.assignment?.declines ?? []).length,
      r.billing?.billAmount, r.billing?.status, r.billing?.method ? (PAYMENT_METHOD_LABEL as any)[r.billing.method] : '', r.billing?.invoiceNo, r.billing?.invoiceAmount,
      r.billing?.invoicePrinted == null ? '' : r.billing.invoicePrinted ? 'Yes' : 'No',
      r.transport?.mode ? (TRANSPORT_MODE_LABEL as any)[r.transport.mode] : '',
      (r.pettyCash ?? []).filter((p: any) => p.status === 'APPROVED').reduce((a: number, p: any) => a + (p.amount ?? 0), 0) || '',
      r.feedback?.rating, r.feedback?.comment, r.cancellation?.reason,
    ]
  })
  return { csv: toCsv(head, data), count: rows.length, filename: `unico-homecare-requests_${f.from}_to_${f.to}.csv` }
}

/** Message log export (same filters as the Messages page). */
export async function messagesCsv(p: { channel?: string | null; status?: string | null; q?: string | null; from?: string | null; to?: string | null }) {
  const f: Record<string, any> = {}
  if (p.channel) f.channel = { $in: p.channel.split(',') }
  if (p.status) f.status = { $in: p.status.split(',') }
  if (p.q) {
    const rx = new RegExp(p.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    f.$or = [{ to: rx }, { toName: rx }, { subject: rx }, { templateKey: rx }]
  }
  if (p.from || p.to) {
    f.at = {}
    if (p.from && YMD.test(p.from)) f.at.$gte = dayRange(p.from).start
    if (p.to && YMD.test(p.to)) f.at.$lt = dayRange(p.to).end
  }
  const items = await MessageLog.find(f).select('-renderedHtml').sort({ at: -1 }).limit(10000).lean<any[]>()
  const users = await User.find({ _id: { $in: items.map((i) => i.initiatedBy).filter(Boolean) } }).select('name').lean<any[]>()
  const reqs = await HomecareRequest.find({ _id: { $in: items.map((i) => i.requestId).filter(Boolean) } }).select('requestNo').lean<any[]>()
  const head = ['Time', 'Channel', 'Provider', 'To', 'Recipient name', 'Template', 'Subject', 'Status', 'Attempts', 'Error', 'Initiated by', 'Request no', 'Text']
  const rows = items.map((i) => [
    dt(i.at), i.channel, i.provider, i.to, i.toName, i.templateKey, i.subject, i.status, i.attempts, i.error,
    users.find((u) => String(u._id) === String(i.initiatedBy))?.name ?? 'System',
    reqs.find((r) => String(r._id) === String(i.requestId))?.requestNo,
    i.renderedText,
  ])
  return { csv: toCsv(head, rows), count: items.length, filename: `unico-homecare-messages_${isoDay()}.csv` }
}
