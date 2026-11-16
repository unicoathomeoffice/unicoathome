import 'server-only'
import { z } from 'zod'
import { HomecareRequest, Patient } from '../models'
import { can } from '../constants'
import { audit } from '../audit'
import { bad, forbidden } from '../api'
import { memo } from '../memo'
import { H360Error } from '../h360'
import { h360Address, h360Profile } from '../h360-patient'
import type { SessionUser } from '../auth'

type Meta = Parameters<typeof audit>[5]

// The patient moved, or H360 has a newer address: change it after the request was made. The patient's record (with
// address history) and this visit's copy change together — optionally the patient's other open visits too.

const OPEN = ['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'ASSIGNED', 'ACCEPTED', 'EN_ROUTE']
const norm = (s?: string | null) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "Baridhara, Vatara, Dhaka" + area "Vatara" → once, not "…, Dhaka, Vatara" */
export function visitAddressText(full?: string | null, area?: string | null) {
  const f = String(full ?? '').trim()
  const a = String(area ?? '').trim()
  return a && !norm(f).includes(norm(a)) ? [f, a].filter(Boolean).join(', ') : f
}

/** The address on file vs H360's present address (cached 10 min). differs = H360 has an address ours doesn't contain. */
export async function addressStatus(r: any) {
  const p = r.patientId ? await Patient.findById(r.patientId).select('uhid address').lean<any>() : null
  const uhid: string | null = p?.uhid || r.patientSnapshot?.uhid || null
  const current = visitAddressText(p?.address?.full, p?.address?.area) || r.patientSnapshot?.address || ''
  let h360: { full: string; area?: string } | null = null
  let offline: string | undefined
  if (uhid) {
    try {
      h360 = await memo(`visit-addr:h360:${uhid}`, 10 * 60_000, async () => h360Address((await h360Profile(uhid))?.presentAddress))
    } catch (e) {
      offline = e instanceof H360Error ? e.message : 'H360 did not answer'
    }
  }
  const ours = norm(`${current} ${p?.address?.house ?? ''} ${p?.address?.flat ?? ''}`)
  const differs = !!h360 && !ours.includes(norm(h360.full)) && !norm(h360.full).includes(norm(current) || '\u0000')
  const others = r.patientId ? await HomecareRequest.countDocuments({ patientId: r.patientId, _id: { $ne: r._id }, deletedAt: null, status: { $in: OPEN } }) : 0
  return { uhid, current, address: p?.address ?? null, h360, differs, otherOpen: others, offline }
}

export const VisitAddressInput = z.object({
  address: z.object({
    full: z.string().trim().min(3, 'Enter the address').max(300),
    house: z.string().trim().max(80).optional(),
    flat: z.string().trim().max(80).optional(),
    area: z.string().trim().max(80).optional(),
    landmark: z.string().trim().max(160).optional(),
    lat: z.number().min(-90).max(90).nullable().optional(),
    lng: z.number().min(-180).max(180).nullable().optional(),
  }),
  /** also the patient's other open visits */
  otherOpen: z.boolean().default(true),
  /** where it came from (audit): typed / H360 */
  source: z.enum(['TYPED', 'H360']).default('TYPED'),
})

export async function changeVisitAddress(r: any, input: z.infer<typeof VisitAddressInput>, user: SessionUser, meta: Meta) {
  if (!can(user, 'patients.edit') && !can(user, 'requests.manage')) throw forbidden()
  if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)) throw bad('This visit is finished — change the address on the patient profile')
  const a = input.address
  const blank = (s?: string) => (s ? s : undefined)
  const p = r.patientId ? await Patient.findById(r.patientId) : null
  const before = { patient: p?.address?.full ?? null, visit: r.patientSnapshot?.address ?? null }
  if (p) {
    if (a.full !== p.address?.full) {
      const last = p.addressHistory?.[p.addressHistory.length - 1]
      if (last) last.to = new Date()
      p.addressHistory.push({ full: a.full, area: a.area, from: new Date() })
    }
    // a new address without a pin drops the old pin (it would point at the old home)
    p.set('address', { full: a.full, house: blank(a.house), flat: blank(a.flat), area: blank(a.area), landmark: blank(a.landmark), lat: a.lat ?? null, lng: a.lng ?? null })
    await p.save()
  }
  const text = visitAddressText(a.full, a.area) // as at creation: the address + area (house / flat stay on the patient)
  const set = { 'patientSnapshot.address': text, 'patientSnapshot.area': a.area || undefined }
  r.set(set)
  r.version = (r.version ?? 0) + 1
  await r.save()
  let others = 0
  if (input.otherOpen && r.patientId) {
    const res = await HomecareRequest.updateMany({ patientId: r.patientId, _id: { $ne: r._id }, deletedAt: null, status: { $in: OPEN } }, { $set: set, $inc: { version: 1 } })
    others = res.modifiedCount ?? 0
  }
  await audit(user, 'request.address', 'request', r._id, { before, after: { address: text, area: a.area ?? null, pin: a.lat != null, source: input.source, otherVisits: others }, label: r.requestNo }, meta)
  return { address: text, otherVisits: others }
}
