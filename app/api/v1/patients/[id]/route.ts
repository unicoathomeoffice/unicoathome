import { route, body, clientMeta, notFound, forbidden } from '@/lib/api'
import { Patient, HomecareRequest, Attachment, Note, LabResult, isOid } from '@/lib/models'
import { can } from '@/lib/constants'
import { audit, diff } from '@/lib/audit'
import { withPeople } from '@/lib/services/requests'
import { plain } from '@/lib/db'
import { PatientInput } from '@/lib/schemas'

export const GET = route<{ id: string }>(async ({ user, params }) => {
  if (!isOid(params.id)) throw notFound('Patient')
  const patient = await Patient.findOne({ _id: params.id, deletedAt: null }).lean<any>()
  if (!patient) throw notFound('Patient')
  const visits = await HomecareRequest.find({ patientId: params.id, deletedAt: null }).select('-deviceStamps').sort({ createdAt: -1 }).limit(100).lean<any[]>()
  if (!can(user, 'requests.readAll')) {
    const mine = visits.some((v) => [v.assignment?.primaryStaffId, ...(v.assignment?.secondaryStaffIds ?? [])].map(String).includes(user.id))
    if (!mine) throw forbidden('You can only see patients you are visiting')
  }
  await withPeople(visits)
  const [documents, notes, labs] = await Promise.all([
    Attachment.find({ $or: [{ ownerType: 'PATIENT', ownerId: params.id }, { requestId: { $in: visits.map((v) => v._id) } }], deletedAt: null }).sort({ at: -1 }).lean(),
    Note.find({ patientId: params.id, deletedAt: null, $or: [{ visibility: 'TEAM' }, { authorId: user.id }] }).sort({ createdAt: -1 }).limit(50).lean(),
    LabResult.find({ patientId: params.id }).sort({ createdAt: -1 }).lean(),
  ])
  return { patient: plain(patient), visits: plain(visits), documents: plain(documents), notes: plain(notes), labs: plain(labs) }
})

export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('Patient')
    const p = await Patient.findById(params.id)
    if (!p) throw notFound('Patient')
    const input = await body(req, PatientInput.partial())
    const before = p.toObject() as any
    if (input.address?.full && input.address.full !== p.address?.full) {
      const last = p.addressHistory[p.addressHistory.length - 1]
      if (last) last.to = new Date()
      p.addressHistory.push({ full: input.address.full, area: input.address.area, from: new Date() })
    }
    const { address, dob, email, consent, ...rest } = input
    p.set(rest)
    if (address) p.set('address', { ...(before.address ?? {}), ...address })
    if (dob) p.dob = new Date(dob)
    if (email != null) p.email = email || undefined
    if (consent) p.set('consent', { ...consent, at: new Date(), by: user.id })
    await p.save()
    const pick = (o: any) => ({ name: o.name, phone: o.phone, uhid: o.uhid, address: o.address?.full, area: o.address?.area, consent: o.consent && { whatsapp: o.consent.whatsapp, email: o.consent.email }, allergies: o.allergies })
    await audit(user, 'patient.update', 'patient', p._id, { ...diff(pick(before), pick(p.toObject())), label: p.name }, clientMeta(req, user))
    return { ok: true }
  },
  { perm: 'patients.edit' },
)
