import 'server-only'
import { z } from 'zod'
import { HomecareRequest, Patient, ServiceType } from '../models'
import { getSettings } from '../settings'
import { audit, type Meta } from '../audit'
import { ApiError, bad } from '../api'
import { background, notifyRoles } from '../messaging'
import { createRequest, emailPatient } from './requests'
import { slotOpen } from '../booking'
import type { SessionUser } from '../auth'

/** Bangladeshi mobile → 01XXXXXXXXX, or null. Accepts +880 / 880 / 0 prefixes, spaces and dashes. */
export function bdMobile(raw: string) {
  const d = raw.replace(/\D/g, '')
  const local = d.startsWith('880') ? `0${d.slice(3)}` : d.startsWith('1') && d.length === 10 ? `0${d}` : d
  return /^01[3-9]\d{8}$/.test(local) ? local : null
}

const dhakaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())

export const PublicRequestInput = z.object({
  name: z.string().trim().min(2, 'Enter the patient’s name').max(80),
  phone: z.string().trim().refine((v) => !!bdMobile(v), 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX)'),
  ageYears: z.coerce.number({ message: 'Enter the age' }).int('Whole years only').min(0, 'Enter the age').max(120, 'Enter the age'),
  gender: z.enum(['M', 'F', 'O'], { message: 'Choose a gender' }),
  email: z.string().trim().email('Enter a valid email or leave it empty').max(120).optional().or(z.literal('')),
  house: z.string().trim().min(1, 'House / holding number is required').max(60),
  flat: z.string().trim().min(1, 'Flat / floor is required').max(60),
  road: z.string().trim().min(3, 'Enter road, block and area').max(300),
  area: z.string().trim().max(80).optional(),
  landmark: z.string().trim().max(120).optional(),
  lat: z.number().min(20).max(27).optional(), // Bangladesh
  lng: z.number().min(88).max(93).optional(),
  serviceCodes: z.array(z.string()).min(1, 'Choose at least one service').max(10),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date'),
  slot: z.string().min(1, 'Choose a time slot'),
  notes: z.string().trim().max(1000).optional(),
  intake: z
    .object({ locationSource: z.enum(['gps', 'search', 'pin', 'typed']), accuracyM: z.number().int().min(0).max(100000).optional(), autoFields: z.array(z.enum(['road', 'area', 'landmark'])).max(3).default([]) })
    .optional(),
  website: z.string().max(500).optional(), // honeypot — real people never fill it (the route fakes success)
})
export type PublicRequestInput = z.infer<typeof PublicRequestInput>

/** Requests from the public website are created by this pseudo-user (audit trail: "Website"). */
const WEBSITE = { id: undefined, name: 'Website', role: 'PUBLIC', permissions: ['requests.create'], client: 'web' } as unknown as SessionUser

/** Public home-care request: registers (or updates) the patient by phone + name and opens a NEW request. */
export async function createPublicRequest(input: PublicRequestInput, meta: Meta, patientId?: string) {
  const s = await getSettings()
  const phone = bdMobile(input.phone)!
  const today = dhakaToday()
  const ahead = s.booking.enabled ? Number(s.booking.daysAhead) || 14 : 60
  const latest = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date(Date.now() + ahead * 86400_000))
  if (input.date < today || input.date > latest) throw bad(`Choose a date within the next ${ahead} days`, { date: 'Out of range' })
  if (s.booking.enabled) {
    if (!(await slotOpen(s.booking, input.date, input.slot))) throw new ApiError(409, 'SLOT_TAKEN', 'That time is no longer available. Please choose another slot.', { slot: 'No longer available' })
  } else if (!s.general.slots.includes(input.slot)) throw bad('Choose one of the listed time slots', { slot: 'Invalid' })
  const startTime = /^\d{2}:\d{2}/.test(input.slot) ? input.slot.slice(0, 5) : undefined
  const active = await ServiceType.find({ code: { $in: input.serviceCodes }, isActive: { $ne: false } }).select('code').lean<any[]>()
  if (!active.length) throw bad('Choose at least one service', { serviceCodes: 'Required' })

  const full = [`House ${input.house}`, `Flat ${input.flat}`, input.road].join(', ')
  const address = { area: input.area || undefined, full, house: input.house, flat: input.flat, landmark: input.landmark || undefined, lat: input.lat, lng: input.lng }
  const email = input.email || undefined

  // signed-in patient → their own record; otherwise same person already known? keep one record and move it to the new address
  const existing = patientId
    ? await Patient.findOne({ _id: patientId, deletedAt: null })
    : await Patient.findOne({ phone, name: new RegExp(`^${input.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'), deletedAt: null })
  if (existing) {
    if (existing.address?.full !== full) {
      const last = existing.addressHistory[existing.addressHistory.length - 1]
      if (last) last.to = new Date()
      existing.addressHistory.push({ full, area: address.area, from: new Date() })
    }
    existing.set('address', { ...(existing.toObject().address ?? {}), ...address, district: 'Dhaka', lat: input.lat ?? null, lng: input.lng ?? null })
    existing.set({ ageYears: input.ageYears, gender: input.gender, ...(email ? { email } : {}), ...(patientId ? { name: input.name, phone } : {}) })
    await existing.save()
  }

  let r: any
  try {
    r = await createRequest(
      {
        ...(existing ? { patientId: String(existing._id) } : { patient: { name: input.name, phone, ageYears: input.ageYears, gender: input.gender, email, address } }),
        requester: { type: 'SELF' },
        serviceCodes: active.map((t) => t.code),
        tests: [],
        priority: 'ROUTINE',
        preferredDate: input.date,
        preferredSlot: input.slot,
        preferredTime: startTime,
        complaint: input.notes || undefined,
        source: 'WEBSITE',
      },
      WEBSITE,
      meta,
    )
  } catch (e) {
    if (e instanceof ApiError && e.code === 'DUPLICATE') throw new ApiError(409, 'DUPLICATE', `We already have this request (${e.fields?.requestNo ?? 'received earlier'}). Our coordinator will call you — no need to send it again.`)
    throw e
  }
  if (input.intake) await HomecareRequest.updateOne({ _id: r._id }, { intake: { ...input.intake, locationSource: input.lat == null ? 'typed' : input.intake.locationSource } })
  await audit(WEBSITE, 'request.public_submit', 'request', r._id, { after: { requestNo: r.requestNo, ip: meta.ip }, label: r.requestNo }, meta)
  background(async () => {
    await emailPatient(r, 'patient_received', null)
    await notifyRoles(['FRONT_DESK'], { type: 'REQUEST_CREATED', title: `Website request ${r.requestNo}`, body: `${input.name} · ${phone} · ${input.date} ${input.slot}`, requestId: r._id, url: `/requests/${r._id}`, priority: 'high' })
  })
  return { requestNo: r.requestNo as string, callWithinMin: s.sla.confirmRoutineMin as number }
}
