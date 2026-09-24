import { z } from 'zod'
import { route, body, forbidden, notFound, clientMeta } from '@/lib/api'
import { LabResult, isOid } from '@/lib/models'
import { loadRequest, isTeamMember } from '@/lib/services/requests'
import { background, notifyRoles, notifyUsers } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'
import { can } from '@/lib/constants'
import type { SessionUser } from '@/lib/auth'

const canEnter = (user: SessionUser, r: any) => isTeamMember(user, r) || can(user, 'requests.manage')

/**
 * GET /api/v1/requests/:id/labs — lab results for the visit, plus the visit's listed tests that have
 * no result row yet (virtual rows without an id).
 */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  const rows = await LabResult.find({ requestId: r._id }).sort({ createdAt: 1 }).lean<any[]>()
  const have = new Set(rows.map((x) => x.test))
  const virtual = (r.tests ?? []).filter((t: string) => !have.has(t)).map((t: string) => ({ _id: null, test: t, status: 'NOT_SENT' }))
  return { items: [...plain(rows), ...virtual], canEnter: canEnter(user, r) }
})

const Input = z.object({
  id: z.string().optional(),
  test: z.string().trim().min(1),
  value: z.string().trim().max(60).optional(),
  unit: z.string().trim().max(30).optional(),
  refRange: z.string().trim().max(60).optional(),
  flag: z.enum(['NORMAL', 'HIGH', 'LOW', 'ABNORMAL']).optional(),
  summary: z.string().trim().max(500).optional(),
  eta: z.string().optional(), // ISO date-time
  pending: z.boolean().optional(), // mark sample sent, result awaited
})

/** POST /api/v1/requests/:id/labs — add or update one result (care team / coordinators). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!canEnter(user, r)) throw forbidden('Only the care team or a coordinator can enter results')
  const input = await body(req, Input)
  let row: any = null
  if (input.id) {
    if (!isOid(input.id)) throw notFound('Lab result')
    row = await LabResult.findOne({ _id: input.id, requestId: r._id })
    if (!row) throw notFound('Lab result')
  } else row = (await LabResult.findOne({ requestId: r._id, test: input.test })) ?? new LabResult({ requestId: r._id, patientId: r.patientId, test: input.test, status: 'PENDING' })
  const before = row.isNew ? null : { value: row.value, flag: row.flag, status: row.status }
  for (const k of ['value', 'unit', 'refRange', 'flag', 'summary'] as const) if (input[k] !== undefined) row[k] = input[k] || undefined
  if (input.eta) row.eta = new Date(input.eta)
  const resulted = !!(row.value || row.summary) && !input.pending
  row.status = resulted ? 'RESULTED' : 'PENDING'
  if (resulted) {
    row.resultedAt = row.resultedAt && before?.status === 'RESULTED' ? row.resultedAt : new Date()
    row.by = user.id
  }
  await row.save()
  await audit(user, resulted ? 'lab.result' : 'lab.pending', 'request', r._id, { before, after: { test: row.test, value: row.value, flag: row.flag, status: row.status }, label: `${r.requestNo} · ${row.test}` }, clientMeta(req, user))
  if (resulted && before?.status !== 'RESULTED') {
    const abnormal = row.flag && row.flag !== 'NORMAL'
    background(async () => {
      const n = { type: 'LAB_RESULT', title: `${abnormal ? 'Abnormal result' : 'Result ready'} · ${row.test}`, body: `${r.patientSnapshot?.name} · ${r.requestNo}`, requestId: r._id, priority: abnormal ? ('high' as const) : ('normal' as const) }
      await notifyUsers([r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter((x) => String(x) !== user.id), { ...n, url: `/m/visits/${r._id}/rx?tab=labs` })
      if (abnormal) await notifyRoles(['HC_ADMIN'], { ...n, url: `/requests/${r._id}` }, user.id)
    })
  }
  return { item: plain(row.toObject()) }
})
