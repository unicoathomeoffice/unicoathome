import { z } from 'zod'
import { route, body, clientMeta, qp, bad } from '@/lib/api'
import { Patient, HomecareRequest } from '@/lib/models'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'
import { PatientInput } from '@/lib/schemas'

/** GET /api/v1/patients?q=&zone=&limit= — search by phone (fastest), UHID or name */
export const GET = route(
  async ({ req }) => {
    const p = qp(req)
    const f: Record<string, any> = { deletedAt: null }
    const q = p.get('q')?.trim()
    if (q) {
      const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const digits = q.replace(/\D/g, '')
      f.$or = [{ name: new RegExp(esc, 'i') }, { uhid: new RegExp(`^${esc}`, 'i') }, ...(digits.length >= 4 ? [{ phone: new RegExp(digits.slice(-10)) }] : [])]
    }
    if (p.get('zone')) f['address.area'] = { $in: p.get('zone')!.split(',') }
    const items = await Patient.find(f).sort({ updatedAt: -1 }).limit(Math.min(Number(p.get('limit') ?? 50), 200)).lean<any[]>()
    // attach latest request for board views
    const latest = await HomecareRequest.aggregate([
      { $match: { patientId: { $in: items.map((i) => i._id) }, deletedAt: null } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$patientId', requestId: { $first: '$_id' }, requestNo: { $first: '$requestNo' }, status: { $first: '$status' }, priority: { $first: '$priority' }, scheduledAt: { $first: '$scheduledAt' }, count: { $sum: 1 } } },
    ])
    for (const i of items) i.latest = latest.find((l) => String(l._id) === String(i._id)) ?? null
    return { items: plain(items) }
  },
  { perm: 'requests.create' },
)


export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, PatientInput)
    if (input.uhid && (await Patient.exists({ uhid: input.uhid, deletedAt: null }))) throw bad(`UHID ${input.uhid} already belongs to another patient`, { uhid: 'Duplicate' })
    const p = await Patient.create({
      ...input,
      email: input.email || undefined,
      dob: input.dob ? new Date(input.dob) : undefined,
      address: { ...input.address, district: 'Dhaka' },
      addressHistory: [{ full: input.address.full, area: input.address.area, from: new Date() }],
      consent: { ...(input.consent ?? { whatsapp: true, email: true }), at: new Date(), by: user.id },
      source: 'PHONE',
      createdBy: user.id,
    })
    await audit(user, 'patient.create', 'patient', p._id, { after: { name: p.name, phone: p.phone, uhid: p.uhid }, label: p.name }, clientMeta(req, user))
    return { id: String(p._id) }
  },
  { perm: 'patients.edit' },
)
