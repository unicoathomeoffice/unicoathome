import { z } from 'zod'
import { route, body, clientMeta, conflict, forbidden } from '@/lib/api'
import { Patient } from '@/lib/models'
import { can } from '@/lib/constants'
import { loadRequest, withPeople, slaInfo } from '@/lib/services/requests'
import { audit, diff } from '@/lib/audit'
import { getSettings } from '@/lib/settings'
import { plain } from '@/lib/db'

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const doc = await loadRequest(params.id, user)
  const r = doc.toObject() as any
  await withPeople([r])
  r.sla = slaInfo(r, await getSettings())
  const patient = await Patient.findById(r.patientId).lean()
  return { request: plain(r), patient: plain(patient) }
})

const Patch = z.object({
  version: z.number().optional(), // optimistic concurrency
  priority: z.enum(['ROUTINE', 'URGENT', 'EMERGENCY']).optional(),
  tests: z.array(z.string()).optional(),
  expectedDurationMin: z.coerce.number().int().positive().optional(),
  complaint: z.string().optional(),
  clinicalNotes: z.string().optional(),
  referringDoctor: z.string().optional(),
  instructions: z.string().optional(),
  remarks: z.string().optional(),
  estimatedFee: z.coerce.number().nonnegative().optional(),
  paymentMethod: z.enum(['CASH', 'BKASH', 'NAGAD', 'CARD']).optional(),
  transportNeeded: z.boolean().optional(),
})

/** General field edits by coordinators / front desk. Lifecycle changes go through /requests/:id/:action. */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const input = await body(req, Patch)
  const isTeam = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].map(String).includes(user.id)
  if (!can(user.role, 'patients.edit') && !(isTeam && Object.keys(input).every((k) => ['tests', 'version'].includes(k)))) throw forbidden()
  if (input.version != null && input.version !== r.version) throw conflict('VERSION_CONFLICT', 'Someone else changed this request. Reload to see the latest version.')
  const before = { priority: r.priority, tests: r.tests, expectedDurationMin: r.expectedDurationMin, clinical: r.clinical?.complaint, instructions: r.assignment?.instructions, remarks: r.remarks, fee: r.billing?.estimatedFee }
  if (input.priority) r.priority = input.priority
  if (input.tests) r.tests = input.tests
  if (input.expectedDurationMin) r.expectedDurationMin = input.expectedDurationMin
  if (input.complaint != null) r.set('clinical.complaint', input.complaint)
  if (input.clinicalNotes != null) r.set('clinical.notes', input.clinicalNotes)
  if (input.referringDoctor != null) r.set('clinical.referringDoctor', input.referringDoctor)
  if (input.instructions != null) r.set('assignment.instructions', input.instructions)
  if (input.remarks != null) r.remarks = input.remarks
  if (input.estimatedFee != null) r.set('billing.estimatedFee', input.estimatedFee)
  if (input.paymentMethod) r.set('billing.method', input.paymentMethod)
  if (input.transportNeeded != null) {
    r.set('transport.needed', input.transportNeeded)
    if (input.transportNeeded && !r.transport?.status) r.set('transport.status', 'REQUESTED')
  }
  r.version = (r.version ?? 0) + 1
  await r.save()
  const after = { priority: r.priority, tests: r.tests, expectedDurationMin: r.expectedDurationMin, clinical: r.clinical?.complaint, instructions: r.assignment?.instructions, remarks: r.remarks, fee: r.billing?.estimatedFee }
  await audit(user, 'request.update', 'request', r._id, { ...diff(before, after), label: r.requestNo }, clientMeta(req, user))
  return { ok: true, version: r.version }
})
