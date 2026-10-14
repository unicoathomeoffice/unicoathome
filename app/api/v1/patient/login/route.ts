import { cookies } from 'next/headers'
import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { LoginInput, loginPatient } from '@/lib/services/patients-portal'
import { issuePatientToken, patientCookie } from '@/lib/patient-auth'

// per IP + phone: 8 failed attempts → 15 minutes
const attempts = new Map<string, { n: number; until: number }>()

/** POST /api/v1/patient/login { phone, password } */
export const POST = publicRoute(async ({ req }) => {
  const meta = { ...clientMeta(req), client: 'portal' }
  const input = await body(req, LoginInput)
  const key = `${meta.ip}:${input.phone.replace(/\D/g, '')}`
  const a = attempts.get(key)
  if (a && a.n >= 8 && a.until > Date.now()) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.')
  let p
  try {
    p = await loginPatient(input, meta)
  } catch (e) {
    attempts.set(key, { n: (a?.n ?? 0) + 1, until: Date.now() + 15 * 60_000 })
    throw e
  }
  attempts.delete(key)
  const { token, expiresAt } = await issuePatientToken(String(p._id), Number(p.passwordVersion ?? 0))
  ;(await cookies()).set(patientCookie(token, expiresAt))
  return { ok: true, redirect: '/my' }
})
