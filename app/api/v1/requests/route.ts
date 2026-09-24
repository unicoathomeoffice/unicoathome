import { route, body, clientMeta, qp } from '@/lib/api'
import { HomecareRequest } from '@/lib/models'
import { can, STATUSES } from '@/lib/constants'
import { createRequest, CreateRequestInput, withPeople, slaInfo } from '@/lib/services/requests'
import { dayRange } from '@/lib/format'
import { getSettings } from '@/lib/settings'
import { plain } from '@/lib/db'

/** GET /api/v1/requests?status=NEW,CONFIRMED&date=2026-09-24&staff=<id>&priority=URGENT&q=&mine=1&limit=100 */
export const GET = route(async ({ req, user }) => {
  const p = qp(req)
  const f: Record<string, any> = { deletedAt: null }
  const statuses = p.get('status')?.split(',').filter((s) => (STATUSES as readonly string[]).includes(s))
  if (statuses?.length) f.status = { $in: statuses }
  if (p.get('priority')) f.priority = { $in: p.get('priority')!.split(',') }
  if (p.get('service')) f['services.code'] = { $in: p.get('service')!.split(',') }
  if (p.get('zone')) f['patientSnapshot.area'] = { $in: p.get('zone')!.split(',') }
  if (p.get('date')) {
    const { start, end } = dayRange(p.get('date')!)
    f.scheduledAt = { $gte: start, $lt: end }
  }
  if (p.get('staff')) f.$or = [{ 'assignment.primaryStaffId': p.get('staff') }, { 'assignment.secondaryStaffIds': p.get('staff') }]
  if (p.get('q')) {
    const q = p.get('q')!.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    f.$and = [{ $or: [{ requestNo: new RegExp(q, 'i') }, { 'patientSnapshot.name': new RegExp(q, 'i') }, { 'patientSnapshot.phone': new RegExp(q.replace(/\D/g, '') || q) }, { 'patientSnapshot.uhid': new RegExp(q, 'i') }] }]
  }
  if (!can(user.role, 'requests.readAll') || p.get('mine') === '1') {
    const mine = [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }, { createdBy: user.id }, { 'transport.driverId': user.id }]
    f.$and = [...(f.$and ?? []), { $or: user.role === 'TRANSPORT_SUPERVISOR' && p.get('mine') !== '1' ? [...mine, { 'transport.needed': true }] : mine }]
  }
  const limit = Math.min(Number(p.get('limit') ?? 200), 500)
  const rows = await HomecareRequest.find(f)
    .select('-visit.notes -clinical.notes -deviceStamps')
    .sort(p.get('sort') === 'created' ? { createdAt: -1 } : { scheduledAt: 1, createdAt: -1 })
    .limit(limit)
    .lean<any[]>()
  await withPeople(rows)
  const s = await getSettings()
  for (const r of rows) r.sla = slaInfo(r, s)
  return { items: plain(rows) }
})

export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, CreateRequestInput)
    const r = await createRequest(input, user, clientMeta(req, user))
    return { id: String(r._id), requestNo: r.requestNo }
  },
  { perm: 'requests.create' },
)
