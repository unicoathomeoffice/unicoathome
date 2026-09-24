import { z } from 'zod'
import { route, body, bad, conflict, forbidden, clientMeta } from '@/lib/api'
import { Patient, Prescription, User, Designation } from '@/lib/models'
import { loadRequest, isTeamMember } from '@/lib/services/requests'
import { background, notifyRoles, prepareWhatsApp } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'
import type { SessionUser } from '@/lib/auth'

const Rx = z.object({
  dx: z.string().max(2000).optional(),
  items: z.array(z.object({ drug: z.string().trim().min(1), dose: z.string().optional(), duration: z.string().optional(), note: z.string().optional() })).max(40).optional(),
  advice: z.string().max(4000).optional(),
})

/** Doctors on the care team write the e-Rx; coordinators may read. */
function canWrite(user: SessionUser, r: any) {
  return user.role === 'DOCTOR' && isTeamMember(user, r)
}

async function doctorInfo(id: unknown) {
  if (!id) return null
  const u = await User.findById(id).select('name employeeId role designationId').lean<any>()
  if (!u) return null
  const d = u.designationId ? await Designation.findById(u.designationId).select('title').lean<any>() : null
  return { id: String(u._id), name: u.name, employeeId: u.employeeId, designation: d?.title ?? 'Doctor' }
}

/** GET /api/v1/requests/:id/prescription */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  const rx = await Prescription.findOne({ requestId: r._id }).sort({ createdAt: -1 }).lean<any>()
  return { prescription: plain(rx), doctor: await doctorInfo(rx?.doctorId), canEdit: canWrite(user, r) && rx?.status !== 'SIGNED' }
})

async function save(r: any, input: z.infer<typeof Rx>, user: SessionUser) {
  let rx = await Prescription.findOne({ requestId: r._id }).sort({ createdAt: -1 })
  if (rx?.status === 'SIGNED') throw conflict('RX_SIGNED', 'This prescription is signed and can no longer be edited')
  const before = rx ? { dx: rx.dx, items: rx.items?.length, advice: rx.advice } : null
  if (!rx) rx = new Prescription({ requestId: r._id, patientId: r.patientId, doctorId: user.id, status: 'DRAFT' })
  if (input.dx != null) rx.dx = input.dx
  if (input.items) rx.items = input.items
  if (input.advice != null) rx.advice = input.advice
  if (!rx.doctorId) rx.doctorId = user.id
  await rx.save()
  return { rx, before }
}

/** PUT /api/v1/requests/:id/prescription {dx?, items?, advice?} — save draft (doctor on the team) */
export const PUT = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!canWrite(user, r)) throw forbidden('Only the doctor on this visit can write the prescription')
  const input = await body(req, Rx)
  const { rx, before } = await save(r, input, user)
  await audit(user, 'prescription.save', 'request', r._id, { before, after: { dx: rx.dx, items: rx.items?.length, advice: !!rx.advice, status: rx.status }, label: r.requestNo }, clientMeta(req, user))
  return { prescription: plain(rx.toObject()) }
})

/**
 * POST /api/v1/requests/:id/prescription {dx?, items?, advice?} — save, sign and prepare the WhatsApp to the patient.
 * The message only carries a link to the report page, never the prescription itself.
 */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  if (!canWrite(user, r)) throw forbidden('Only the doctor on this visit can sign the prescription')
  const input = await body(req, Rx)
  const { rx } = await save(r, input, user)
  if (!rx.dx?.trim() && !rx.items?.length) throw bad('Add a diagnosis or at least one medicine before signing')
  rx.status = 'SIGNED'
  rx.signedAt = new Date()
  rx.doctorId = user.id
  const p = await Patient.findById(r.patientId).select('name phone consent').lean<any>()
  let wa: { url: string; logId: string } | null = null
  if (p?.phone && p.consent?.whatsapp !== false) {
    const link = `${process.env.APP_BASE_URL ?? ''}/print/report/${r._id}`
    const text = `Dear ${p.name}, your prescription from Unico Hospitals Home Care (${r.requestNo}) is ready. Open it here: ${link}\n— ${user.name}, Family Medicine`
    wa = await prepareWhatsApp({ to: p.phone, toName: p.name, text, templateKey: 'prescription_ready', requestId: r._id, patientId: r.patientId, initiatedBy: user.id })
    rx.sentAt = new Date()
  }
  await rx.save()
  await audit(user, 'prescription.sign', 'request', r._id, { after: { status: 'SIGNED', items: rx.items?.length, whatsapp: !!wa }, label: r.requestNo }, clientMeta(req, user))
  background(() => notifyRoles(['HC_ADMIN'], { type: 'SYSTEM', title: `Prescription signed · ${r.requestNo}`, body: `${user.name} · ${r.patientSnapshot?.name}`, requestId: r._id, url: `/requests/${r._id}` }, user.id))
  return { prescription: plain(rx.toObject()), whatsapp: wa ? { url: wa.url, logId: wa.logId } : null, consent: p?.consent?.whatsapp !== false }
})
