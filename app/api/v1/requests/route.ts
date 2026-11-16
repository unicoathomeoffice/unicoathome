import { route, body, clientMeta, qp, forbidden } from '@/lib/api'
import { HomecareRequest } from '@/lib/models'
import { can, STATUSES, hasRole } from '@/lib/constants'
import { createAndAssign, CreateRequestInput, withPeople, slaInfo } from '@/lib/services/requests'
import { dayRange } from '@/lib/format'
import { getSettings } from '@/lib/settings'
import { plain } from '@/lib/db'
import { createSchedule, RepeatInput } from '@/lib/services/schedules'

export const maxDuration = 60 // a repeating request also makes its first two weeks of visits

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
  if (!can(user, 'requests.readAll') || p.get('mine') === '1') {
    const mine = [{ 'assignment.primaryStaffId': user.id }, { 'assignment.secondaryStaffIds': user.id }, { createdBy: user.id }, { 'transport.driverId': user.id }]
    f.$and = [...(f.$and ?? []), { $or: hasRole(user, 'TRANSPORT_SUPERVISOR') && p.get('mine') !== '1' ? [...mine, { 'transport.needed': true }] : mine }]
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

// repeat: { pattern, end, time? } — this request is visit 1 and the schedule makes the next ones (Schedules page)
const CreateWithRepeat = CreateRequestInput.extend({ repeat: RepeatInput.optional() })

export const POST = route(
  async ({ req, user }) => {
    const { repeat, ...input } = await body(req, CreateWithRepeat)
    if (repeat && !can(user, 'requests.manage')) throw forbidden('Only coordinators can make repeating schedules')
    const meta = clientMeta(req, user)
    // then: 'confirm' | 'assign' — confirmed (and the care team assigned) in the same call
    const r = await createAndAssign(input, user, meta)
    let schedule: { id: string; made: number } | null = null
    let scheduleError: string | null = null
    if (repeat) {
      try {
        schedule = await createSchedule({ fromRequestId: String(r._id), ...repeat }, user, meta)
      } catch (e: any) {
        scheduleError = e?.message ?? 'The schedule could not be made' // the request stays; "Repeat on a schedule" on it
      }
    }
    return { id: String(r._id), requestNo: r.requestNo, status: r.status, ...(repeat ? { schedule, scheduleError } : {}) }
  },
  { perm: 'requests.create' },
)
