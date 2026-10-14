import { cookies } from 'next/headers'
import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { RegisterInput, registerPatient } from '@/lib/services/patients-portal'
import { issuePatientToken, patientCookie } from '@/lib/patient-auth'

const hits = new Map<string, number[]>()

/** POST /api/v1/patient/register — create a patient account and sign in. */
export const POST = publicRoute(async ({ req }) => {
  const meta = { ...clientMeta(req), client: 'portal' }
  const now = Date.now()
  const recent = (hits.get(meta.ip) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= 10) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Please try again later.')
  hits.set(meta.ip, [...recent, now])
  const input = await body(req, RegisterInput)
  const p = await registerPatient(input, meta)
  const { token, expiresAt } = await issuePatientToken(String(p._id), 1)
  ;(await cookies()).set(patientCookie(token, expiresAt))
  return { ok: true, redirect: '/my' }
})
