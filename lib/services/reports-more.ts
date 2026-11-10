import 'server-only'
import { Equipment, HomecareRequest, User } from '../models'
import { getSettings } from '../settings'
import { TZ } from '../constants'
import { match, normaliseFilter, toCsv, type ReportFilter } from './reports'

// Reports → Services · Consumables · Staff tabs: the same window and filters as the Overview (requests created in the
// chosen days, Asia/Dhaka), each with an Excel (CSV) export.

const DONE = ['COMPLETED', 'CLOSED']
const MIN = 60000
const cnt = (cond: unknown) => ({ $sum: { $cond: [cond, 1, 0] } })
const mins = (a: string, b: string) => ({ $cond: [{ $and: [{ $ne: [{ $ifNull: [a, null] }, null] }, { $ne: [{ $ifNull: [b, null] }, null] }] }, { $divide: [{ $subtract: [b, a] }, MIN] }, null] })
const r1 = (v: number | null | undefined) => (v == null ? null : Math.round(v * 10) / 10)
const pct = (ok: number, n: number) => (n ? Math.round((ok / n) * 100) : null)
const amount = { $ifNull: ['$billing.invoiceAmount', { $ifNull: ['$billing.billAmount', 0] }] }

// ---------------------------------------------------------------- services provided
export async function servicesReport(input: ReportFilter) {
  const f = normaliseFilter(input)
  const [agg] = await HomecareRequest.aggregate([
    { $match: match(f) },
    { $addFields: { _done: { $in: ['$status', DONE] }, _month: { $dateToString: { date: '$timeline.requestedAt', format: '%Y-%m', timezone: TZ } }, _amt: amount, _dur: { $ifNull: ['$visit.durationMin', mins('$timeline.checkInAt', '$timeline.checkOutAt')] } } },
    {
      $facet: {
        services: [
          { $unwind: '$services' },
          {
            $group: {
              _id: { $ifNull: ['$services.name', 'Other'] },
              requested: { $sum: 1 },
              completed: cnt('$_done'),
              cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }),
              open: cnt({ $not: [{ $in: ['$status', [...DONE, 'CANCELLED']] }] }),
              amount: { $sum: { $cond: ['$_done', '$_amt', 0] } },
              avgDur: { $avg: '$_dur' },
              patients: { $addToSet: '$patientId' },
            },
          },
          { $sort: { requested: -1 } },
        ],
        months: [{ $group: { _id: '$_month', requested: { $sum: 1 }, completed: cnt('$_done'), cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }), amount: { $sum: { $cond: ['$_done', '$_amt', 0] } } } }, { $sort: { _id: 1 } }],
        totals: [{ $group: { _id: null, requested: { $sum: 1 }, completed: cnt('$_done'), cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }), amount: { $sum: { $cond: ['$_done', '$_amt', 0] } }, patients: { $addToSet: '$patientId' } } }],
      },
    },
  ])
  const t = agg.totals[0] ?? { requested: 0, completed: 0, cancelled: 0, amount: 0, patients: [] }
  return {
    filter: f,
    totals: { requested: t.requested, completed: t.completed, cancelled: t.cancelled, cancelPct: pct(t.cancelled, t.requested), amount: Math.round(t.amount), patients: t.patients.length },
    services: (agg.services as any[]).map((s) => ({ name: s._id, requested: s.requested, completed: s.completed, cancelled: s.cancelled, open: s.open, cancelPct: pct(s.cancelled, s.requested), amount: Math.round(s.amount), avgDur: r1(s.avgDur), patients: s.patients.length })),
    months: (agg.months as any[]).map((m) => ({ month: m._id as string, requested: m.requested, completed: m.completed, cancelled: m.cancelled, amount: Math.round(m.amount) })),
  }
}

// ---------------------------------------------------------------- consumables used
export async function consumablesReport(input: ReportFilter) {
  const f = normaliseFilter(input)
  const [agg] = await HomecareRequest.aggregate([
    { $match: match(f) },
    { $addFields: { _done: { $in: ['$status', DONE] }, _svc: { $ifNull: [{ $arrayElemAt: ['$services.name', 0] }, 'Other'] } } },
    {
      $facet: {
        items: [
          { $unwind: '$visit.consumables' },
          { $match: { 'visit.consumables.qty': { $gt: 0 } } },
          { $group: { _id: { $ifNull: [{ $toString: '$visit.consumables.itemId' }, { $concat: ['text:', { $toLower: '$visit.consumables.item' }] }] }, name: { $last: '$visit.consumables.item' }, unit: { $last: '$visit.consumables.unit' }, qty: { $sum: '$visit.consumables.qty' }, visits: { $addToSet: '$_id' } } },
          { $sort: { qty: -1 } },
        ],
        byService: [{ $unwind: '$visit.consumables' }, { $match: { 'visit.consumables.qty': { $gt: 0 } } }, { $group: { _id: { svc: '$_svc', item: '$visit.consumables.item' }, qty: { $sum: '$visit.consumables.qty' } } }, { $sort: { qty: -1 } }, { $limit: 200 }],
        byStaff: [{ $unwind: '$visit.consumables' }, { $match: { 'visit.consumables.qty': { $gt: 0 } } }, { $group: { _id: '$assignment.primaryStaffId', qty: { $sum: '$visit.consumables.qty' }, visits: { $addToSet: '$_id' } } }, { $sort: { qty: -1 } }, { $limit: 15 }],
        recorded: [{ $match: { _done: true } }, { $group: { _id: null, done: { $sum: 1 }, withUse: cnt({ $gt: [{ $size: { $ifNull: ['$visit.consumables', []] } }, 0] }) } }],
        // journeys with a bag: was every must-take item packed?
        bags: [
          { $match: { 'visit.kitSet': true, 'timeline.enRouteAt': { $ne: null } } },
          { $project: { short: { $size: { $filter: { input: { $ifNull: ['$visit.kit', []] }, cond: { $lt: [{ $ifNull: ['$$this.packedQty', 0] }, { $ifNull: ['$$this.minQty', 0] }] } } } }, items: { $size: { $ifNull: ['$visit.kit', []] } } } },
          { $match: { items: { $gt: 0 } } },
          { $group: { _id: null, journeys: { $sum: 1 }, complete: cnt({ $eq: ['$short', 0] }) } },
        ],
      },
    },
  ])
  const ids = (agg.items as any[]).map((i) => i._id).filter((x: string) => /^[a-f0-9]{24}$/i.test(x))
  const [eq, staff] = await Promise.all([
    ids.length ? Equipment.find({ _id: { $in: ids } }).select('name unit imageId').lean<any[]>() : [],
    User.find({ _id: { $in: (agg.byStaff as any[]).map((s) => s._id).filter(Boolean) } }).select('name').lean<any[]>(),
  ])
  const rec = agg.recorded[0] ?? { done: 0, withUse: 0 }
  const bag = agg.bags[0] ?? { journeys: 0, complete: 0 }
  return {
    filter: f,
    items: (agg.items as any[]).map((i) => {
      const e = eq.find((x) => String(x._id) === i._id)
      const visits = i.visits.length
      return { id: i._id, catalogId: e ? String(e._id) : null, imageId: e?.imageId ? String(e.imageId) : null, name: e?.name ?? i.name, unit: e?.unit ?? i.unit ?? 'pcs', qty: i.qty, visits, perVisit: r1(i.qty / Math.max(1, visits)) }
    }),
    byService: (agg.byService as any[]).map((x) => ({ service: x._id.svc, item: x._id.item, qty: x.qty })),
    byStaff: (agg.byStaff as any[]).map((x) => ({ name: staff.find((u) => String(u._id) === String(x._id))?.name ?? 'Unassigned', qty: x.qty, visits: x.visits.length })),
    recordedPct: pct(rec.withUse, rec.done),
    completedVisits: rec.done,
    bagJourneys: bag.journeys,
    bagCompletePct: pct(bag.complete, bag.journeys),
  }
}

// ---------------------------------------------------------------- staff productivity
export async function staffReport(input: ReportFilter) {
  const f = normaliseFilter(input)
  const s = await getSettings()
  const late = (s.sla.lateAfterMin ?? 10) * MIN
  const rows = await HomecareRequest.aggregate([
    { $match: match(f) },
    {
      $addFields: {
        _done: { $in: ['$status', DONE] },
        _team: { $filter: { input: { $concatArrays: [['$assignment.primaryStaffId'], { $ifNull: ['$assignment.secondaryStaffIds', []] }] }, cond: { $ne: ['$$this', null] } } },
        _onTime: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$timeline.checkInAt', null] }, null] }, { $ne: [{ $ifNull: ['$scheduledAt', null] }, null] }] }, { $lte: ['$timeline.checkInAt', { $add: ['$scheduledAt', late] }] }, null] },
        _dur: { $ifNull: ['$visit.durationMin', mins('$timeline.checkInAt', '$timeline.checkOutAt')] },
        _out: mins('$timeline.enRouteAt', '$timeline.checkInAt'),
        _back: { $ifNull: ['$returnTrip.durationMin', mins('$timeline.checkOutAt', '$returnTrip.reachedAt')] },
        _afterOpen: { $size: { $filter: { input: { $ifNull: ['$visit.afterChecklist', []] }, cond: { $and: ['$$this.mandatory', { $not: ['$$this.done'] }] } } } },
        _afterAny: { $gt: [{ $size: { $ifNull: ['$visit.afterChecklist', []] } }, 0] },
        _cons: { $gt: [{ $size: { $ifNull: ['$visit.consumables', []] } }, 0] },
      },
    },
    { $unwind: '$_team' },
    {
      $group: {
        _id: '$_team',
        visits: { $sum: 1 },
        completed: cnt('$_done'),
        cancelled: cnt({ $eq: ['$status', 'CANCELLED'] }),
        checkedIn: cnt({ $ne: ['$_onTime', null] }),
        onTime: cnt({ $eq: ['$_onTime', true] }),
        avgDur: { $avg: '$_dur' },
        avgOut: { $avg: '$_out' },
        avgBack: { $avg: '$_back' },
        afterVisits: cnt({ $and: ['$_done', '$_afterAny'] }),
        afterDone: cnt({ $and: ['$_done', '$_afterAny', { $eq: ['$_afterOpen', 0] }] }),
        consRecorded: cnt({ $and: ['$_done', '$_cons'] }),
        amount: { $sum: { $cond: ['$_done', amount, 0] } },
      },
    },
    { $sort: { visits: -1 } },
  ])
  const users = await User.find({ _id: { $in: rows.map((r: any) => r._id) } }).select('name role employeeId external').lean<any[]>()
  return {
    filter: f,
    staff: rows.map((r: any) => {
      const u = users.find((x) => String(x._id) === String(r._id))
      return {
        id: String(r._id),
        name: u?.name ?? 'Unknown staff',
        role: u?.role ?? '',
        employeeId: u?.employeeId ?? '',
        external: !!u?.external,
        visits: r.visits,
        completed: r.completed,
        cancelled: r.cancelled,
        onTimePct: pct(r.onTime, r.checkedIn),
        avgDur: r1(r.avgDur),
        avgOut: r1(r.avgOut),
        avgBack: r1(r.avgBack),
        afterPct: pct(r.afterDone, r.afterVisits),
        consPct: pct(r.consRecorded, r.completed),
        amount: Math.round(r.amount),
      }
    }),
  }
}

// ---------------------------------------------------------------- Excel (CSV) exports
export async function moreCsv(type: 'services' | 'consumables' | 'staff', input: ReportFilter) {
  const f = normaliseFilter(input)
  const tag = `${f.from}_${f.to}`
  if (type === 'services') {
    const r = await servicesReport(f)
    const rows = r.services.map((s) => [s.name, s.requested, s.completed, s.cancelled, s.open, s.cancelPct ?? '', s.patients, s.avgDur ?? '', s.amount])
    return { csv: toCsv(['Service', 'Requested', 'Completed', 'Cancelled', 'Open', 'Cancel %', 'Patients', 'Avg visit (min)', 'Amount (BDT)'], rows), filename: `services_${tag}.csv`, count: rows.length }
  }
  if (type === 'consumables') {
    const r = await consumablesReport(f)
    const rows = r.items.map((i) => [i.name, i.unit, i.qty, i.visits, i.perVisit ?? ''])
    return { csv: toCsv(['Item', 'Unit', 'Quantity used', 'Visits', 'Per visit'], rows), filename: `consumables_${tag}.csv`, count: rows.length }
  }
  const r = await staffReport(f)
  const rows = r.staff.map((s) => [s.name, s.employeeId, s.role, s.external ? 'Outside (HIS)' : '', s.visits, s.completed, s.cancelled, s.onTimePct ?? '', s.avgDur ?? '', s.avgOut ?? '', s.avgBack ?? '', s.afterPct ?? '', s.consPct ?? '', s.amount])
  return { csv: toCsv(['Staff', 'Employee ID', 'Role', 'Outside', 'Visits', 'Completed', 'Cancelled', 'On time %', 'Avg visit (min)', 'Avg travel out (min)', 'Avg travel back (min)', 'After-return done %', 'Consumables recorded %', 'Amount (BDT)'], rows), filename: `staff_${tag}.csv`, count: rows.length }
}
