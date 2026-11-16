import { cookies } from 'next/headers'
import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { LoginUhidInput, loginWithUhid } from '@/lib/services/patients-portal'
import { issuePatientToken, patientCookie } from '@/lib/patient-auth'

export const maxDuration = 30

// per IP + UHID: 8 failed tries → 15 minutes; per IP: 30 tries an hour (a UHID + mobile pair can be guessed at)
const attempts = new Map<string, { n: number; until: number }>()
const perIp = new Map<string, { n: number; until: number }>()

/** POST /api/v1/patient/login-uhid { uhid, mobile } — sign in with the hospital patient portal's pair: UHID + the mobile
 *  number registered in H360 (checked with H360's read-only patient search; nothing is sent to H360's portal). */
export const POST = publicRoute(async ({ req }) => {
  const meta = { ...clientMeta(req), client: 'portal' }
  const input = await body(req, LoginUhidInput)
  const now = Date.now()
  const ip = String(meta.ip ?? '?')
  const key = `${ip}:${input.uhid.trim().toLowerCase()}`
  const a = attempts.get(key)
  const b = perIp.get(ip)
  if ((a && a.n >= 8 && a.until > now) || (b && b.n >= 30 && b.until > now)) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Try again in 15 minutes.')
  perIp.set(ip, b && b.until > now ? { n: b.n + 1, until: b.until } : { n: 1, until: now + 3600_000 })
  let p
  try {
    p = await loginWithUhid(input, meta)
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) attempts.set(key, { n: (a && a.until > now ? a.n : 0) + 1, until: now + 15 * 60_000 })
    throw e
  }
  attempts.delete(key)
  const { token, expiresAt } = await issuePatientToken(String(p._id), Number(p.passwordVersion ?? 0))
  ;(await cookies()).set(patientCookie(token, expiresAt))
  return { ok: true, redirect: '/my' }
})
