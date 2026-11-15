import 'server-only'
import { can } from '../constants'
import { HomecareRequest, Patient } from '../models'
import { withPeople } from './requests'
import type { SessionUser } from '../auth'

const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Global search (web /search, GET /api/v1/search): requests by number, patient name, UHID or phone digits, and
 * patients with their visit counts. People who don't read every request only find their own team's or ones they
 * created. `exact` is set when the text is a request number matching exactly one request: open it straight away.
 */
export async function searchAll(user: SessionUser, query: string) {
  const q = query.trim()
  if (!q) return { q, exact: null as string | null, requests: [] as any[], patients: [] as any[] }
  const readAll = can(user, 'requests.readAll')
  const rx = escRe(q)
  const digits = q.replace(/\D/g, '')
  const short = /^#\s*\d{1,4}$/.test(q) ? `-${digits.padStart(4, '0')}$` : null
  const reqOr: any[] = [
    { requestNo: new RegExp(short ?? rx, 'i') },
    { 'patientSnapshot.name': new RegExp(rx, 'i') },
    { 'patientSnapshot.uhid': new RegExp(`^${rx}`, 'i') },
    ...(digits.length >= 4 ? [{ 'patientSnapshot.phone': new RegExp(digits.slice(-10)) }] : []),
  ]
  const reqFilter: Record<string, any> = { deletedAt: null, $or: reqOr }
  if (!readAll) reqFilter.$and = [{ $or: [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }, { createdBy: user.id }] }]

  let exact: string | null = null
  if (/^(hc-?|#)/i.test(q) || /^\d{6}-\d{1,4}$/.test(q)) {
    const byNo = await HomecareRequest.find({ ...(reqFilter.$and ? { $and: reqFilter.$and } : {}), deletedAt: null, requestNo: new RegExp(short ?? rx, 'i') })
      .select('_id')
      .limit(2)
      .lean<any[]>()
    if (byNo.length === 1) exact = String(byNo[0]._id)
  }

  const [requests, patients] = await Promise.all([
    HomecareRequest.find(reqFilter).select('requestNo status priority patientId patientSnapshot services scheduledAt slot preferred assignment createdAt timeline').sort({ createdAt: -1 }).limit(50).lean<any[]>(),
    Patient.find({ deletedAt: null, $or: [{ name: new RegExp(rx, 'i') }, { uhid: new RegExp(`^${rx}`, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])] })
      .sort({ updatedAt: -1 })
      .limit(30)
      .lean<any[]>(),
  ])
  await withPeople(requests)
  if (patients.length) {
    const counts = await HomecareRequest.aggregate([
      { $match: { patientId: { $in: patients.map((p) => p._id) }, deletedAt: null } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$patientId', n: { $sum: 1 }, last: { $first: '$createdAt' } } },
    ])
    for (const p of patients) {
      const c = counts.find((x) => String(x._id) === String(p._id))
      p.visits = c?.n ?? 0
      p.last = c?.last ?? null
    }
  }
  return { q, exact, requests, patients }
}
