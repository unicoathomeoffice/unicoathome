import 'server-only'
import { z } from 'zod'
import { HomecareRequest, Patient } from '../models'
import { ApiError, bad } from '../api'
import { hashPassword, verifyPassword } from '../auth'
import { audit, type Meta } from '../audit'
import { bdMobile } from './public'
import { withPeople } from './requests'
import type { PatientSession } from '../patient-auth'
import type { RequestCard } from '../../components/patient/RequestCards'
import { ROLE_LABEL, type Role } from '../constants'
import { relDay, time } from '../format'

// Patient portal (/my): create account, sign in, profile, and the patient's own requests.
// An account is a Patient document with a passwordHash. Phone is the login id.

const Phone = z.string().trim().refine((v) => !!bdMobile(v), 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX)')
const Password = z.string().min(6, 'At least 6 characters').max(100)

export const RegisterInput = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  phone: Phone,
  whatsapp: Phone,
  password: Password,
  email: z.string().trim().email('Enter a valid email or leave it empty').max(120).optional().or(z.literal('')),
})
export const LoginInput = z.object({ phone: Phone, password: z.string().min(1, 'Enter your password') })
export const ProfileInput = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  phone: Phone.optional(),
  whatsapp: Phone.optional(),
  email: z.string().trim().email('Enter a valid email or leave it empty').max(120).optional().or(z.literal('')),
  ageYears: z.coerce.number().int().min(0).max(120).optional(),
  gender: z.enum(['M', 'F', 'O']).optional(),
  address: z.object({ road: z.string().trim().max(300).optional(), house: z.string().trim().max(60).optional(), flat: z.string().trim().max(60).optional(), area: z.string().trim().max(80).optional(), landmark: z.string().trim().max(120).optional(), lat: z.number().nullable().optional(), lng: z.number().nullable().optional() }).optional(),
  currentPassword: z.string().optional(),
  newPassword: Password.optional(),
})

const PORTAL = { id: undefined, name: 'Patient portal', role: 'PATIENT' } as any

/** Create the account. If a patient record with this phone already exists (from a phone/website request), it becomes the account. */
export async function registerPatient(input: z.infer<typeof RegisterInput>, meta: Meta) {
  const phone = bdMobile(input.phone)!
  const whatsapp = bdMobile(input.whatsapp)!
  const owned = await Patient.exists({ phone, deletedAt: null, passwordHash: { $exists: true } })
  if (owned) throw new ApiError(409, 'EXISTS', 'An account already uses this mobile number. Please sign in.', { phone: 'Already registered' })
  // claim the most recent unclaimed record with this phone (keeps their visit history), else create one
  let p = await Patient.findOne({ phone, deletedAt: null }).sort({ updatedAt: -1 })
  if (p) p.set({ name: input.name, whatsapp, ...(input.email ? { email: input.email } : {}), passwordHash: await hashPassword(input.password), passwordVersion: 1, account: { createdAt: new Date(), lastLoginAt: new Date() } })
  else p = new Patient({ name: input.name, phone, whatsapp, email: input.email || undefined, passwordHash: await hashPassword(input.password), passwordVersion: 1, source: 'WEBSITE', account: { createdAt: new Date(), lastLoginAt: new Date() } })
  await p.save()
  await audit(PORTAL, 'patient.register', 'patient', p._id, { after: { name: p.name, phone }, label: p.name }, meta)
  return p
}

export async function loginPatient(input: z.infer<typeof LoginInput>, meta: Meta) {
  const phone = bdMobile(input.phone)!
  const p = await Patient.findOne({ phone, deletedAt: null, passwordHash: { $exists: true } }).select('+passwordHash passwordVersion name')
  if (!p || !(await verifyPassword(input.password, p.passwordHash))) {
    await audit(PORTAL, 'patient.login_failed', 'patient', p?._id, { after: { phone } }, meta)
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Mobile number or password is incorrect')
  }
  p.set('account.lastLoginAt', new Date())
  await p.save()
  await audit(PORTAL, 'patient.login', 'patient', p._id, { label: p.name }, meta)
  return p
}

export async function updatePatientProfile(session: PatientSession, input: z.infer<typeof ProfileInput>, meta: Meta) {
  const p = await Patient.findById(session.id).select('+passwordHash')
  if (!p) throw bad('Account not found')
  const before = p.toObject() as any
  if (input.phone) {
    const phone = bdMobile(input.phone)!
    if (phone !== p.phone && (await Patient.exists({ phone, deletedAt: null, passwordHash: { $exists: true }, _id: { $ne: p._id } }))) throw bad('That mobile number already has an account', { phone: 'In use' })
    p.phone = phone
  }
  if (input.whatsapp) p.whatsapp = bdMobile(input.whatsapp)!
  if (input.name) p.name = input.name
  if (input.email != null) p.email = input.email || undefined
  if (input.ageYears != null) p.ageYears = input.ageYears
  if (input.gender) p.gender = input.gender
  if (input.address) {
    const a = input.address
    const full = [a.house && `House ${a.house}`, a.flat && `Flat ${a.flat}`, a.road].filter(Boolean).join(', ')
    if (full && full !== p.address?.full) {
      const last = p.addressHistory[p.addressHistory.length - 1]
      if (last) last.to = new Date()
      p.addressHistory.push({ full, area: a.area, from: new Date() })
    }
    p.set('address', { ...(before.address ?? {}), ...(full ? { full } : {}), house: a.house, flat: a.flat, area: a.area, landmark: a.landmark, lat: a.lat ?? null, lng: a.lng ?? null, district: 'Dhaka' })
  }
  let signOutOthers = false
  if (input.newPassword) {
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, p.passwordHash))) throw bad('Current password is incorrect', { currentPassword: 'Incorrect' })
    p.passwordHash = await hashPassword(input.newPassword)
    p.passwordVersion = Number(p.passwordVersion ?? 0) + 1
    signOutOthers = true
  }
  await p.save()
  await audit({ id: session.id, name: session.name, role: 'PATIENT' } as any, input.newPassword ? 'patient.password_change' : 'patient.profile_update', 'patient', p._id, { before: { phone: before.phone, whatsapp: before.whatsapp, email: before.email }, after: { phone: p.phone, whatsapp: p.whatsapp, email: p.email }, label: p.name }, meta)
  return { patient: p, signOutOthers, passwordVersion: Number(p.passwordVersion ?? 0) }
}

const PROGRESS: Record<string, number> = { NEW: 10, VERIFIED: 20, CONFIRMED: 35, RESCHEDULED: 35, ASSIGNED: 50, ACCEPTED: 60, EN_ROUTE: 75, IN_PROGRESS: 88, COMPLETED: 100, CLOSED: 100, CANCELLED: 100 }

/** Request row → what the patient dashboard card shows (dates pre-formatted, Asia/Dhaka). */
export function toCard(r: any): RequestCard {
  const when = r.scheduledAt ? `${relDay(r.scheduledAt)} · ${time(r.scheduledAt)}` : r.preferred?.date ? `${relDay(r.preferred.date)}${r.preferred.slot ? ` · ${r.preferred.slot}` : ''}` : '—'
  return {
    id: String(r._id),
    requestNo: r.requestNo,
    status: r.status,
    when,
    whenSub: r.slot && r.scheduledAt ? r.slot : undefined,
    services: (r.services ?? []).map((s: any) => s.name),
    staff: r.primaryStaff ? { name: r.primaryStaff.name, role: ROLE_LABEL[r.primaryStaff.role as Role] ?? r.primaryStaff.role } : null,
    progress: PROGRESS[r.status] ?? 10,
  }
}

/** The patient's requests: everything linked to any patient record with their phone (older records too). */
export async function patientRequests(session: PatientSession, limit = 100) {
  const ids = await Patient.find({ phone: session.phone, deletedAt: null }).select('_id').lean<any[]>()
  const rows = await HomecareRequest.find({ patientId: { $in: ids.map((p) => p._id) }, deletedAt: null })
    .select('requestNo status priority scheduledAt slot preferred services assignment timeline visit.checkIn visit.checkOut billing cancellation expectedDurationMin createdAt')
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<any[]>()
  await withPeople(rows)
  return rows
}

export async function patientRequest(session: PatientSession, id: string) {
  const ids = await Patient.find({ phone: session.phone, deletedAt: null }).select('_id').lean<any[]>()
  const r = await HomecareRequest.findOne({ _id: id, patientId: { $in: ids.map((p) => p._id) }, deletedAt: null })
    .select('-visit.notes -deviceStamps -clinical.notes -pettyCash')
    .lean<any>()
  if (!r) return null
  await withPeople([r])
  return r
}
