import { cookies } from 'next/headers'
import { body, clientMeta } from '@/lib/api'
import { patientRoute, issuePatientToken, patientCookie } from '@/lib/patient-auth'
import { ProfileInput, updatePatientProfile } from '@/lib/services/patients-portal'

/** GET /api/v1/patient/me */
export const GET = patientRoute(async ({ patient }) => ({ patient }))

/** PATCH /api/v1/patient/me — profile, contact numbers, address, password */
export const PATCH = patientRoute(async ({ req, patient }) => {
  const input = await body(req, ProfileInput)
  const { patient: p, signOutOthers, passwordVersion } = await updatePatientProfile(patient, input, { ...clientMeta(req), client: 'portal' })
  if (signOutOthers) {
    // new password → new token for this device; every other device is signed out by the version bump
    const { token, expiresAt } = await issuePatientToken(String(p._id), passwordVersion)
    ;(await cookies()).set(patientCookie(token, expiresAt))
  }
  return { ok: true }
})
