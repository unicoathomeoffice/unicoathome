import { json, publicRoute } from '@/lib/api'
import { getUser } from '@/lib/auth'
import { getPatient } from '@/lib/patient-auth'

/**
 * GET /api/v1/public/session — who is looking at the public landing page. The page itself is cached and the same
 * for everyone, so the staff link, the patient's name and the booking-form prefill are fetched after first paint.
 */
export const GET = publicRoute(async () => {
  const [user, patient] = await Promise.all([getUser().catch(() => null), getPatient().catch(() => null)])
  const a = patient?.address
  const body = {
    staff: { href: user ? (user.platformAccess.includes('web') && user.client === 'web' ? '/dashboard' : '/m') : '/login', signedIn: !!user },
    patient: patient ? { name: patient.name } : null,
    prefill: patient
      ? {
          name: patient.name,
          phone: patient.phone,
          email: patient.email ?? '',
          ageYears: patient.ageYears != null ? String(patient.ageYears) : '',
          gender: patient.gender ?? '',
          house: a?.house ?? '',
          flat: a?.flat ?? '',
          road: a?.house || a?.flat ? (a?.full ?? '').replace(/^House [^,]*, Flat [^,]*, /, '') : (a?.full ?? ''),
          area: a?.area ?? '',
          landmark: a?.landmark ?? '',
          lat: a?.lat ?? null,
          lng: a?.lng ?? null,
        }
      : null,
  }
  return json(body, { headers: { 'Cache-Control': 'private, no-store' } }) // personal: never cached by a CDN
})
