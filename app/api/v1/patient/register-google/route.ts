import { z } from 'zod'
import { cookies } from 'next/headers'
import { publicRoute, body, clientMeta, ApiError } from '@/lib/api'
import { readSignup, SIGNUP_COOKIE } from '@/lib/google-auth'
import { issuePatientToken, patientCookie } from '@/lib/patient-auth'
import { registerPatientWithGoogle } from '@/lib/services/patients-portal'
import { bdMobile } from '@/lib/services/public'

const Input = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  phone: z.string().trim().refine((v) => !!bdMobile(v), 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX)'),
  whatsapp: z.string().trim().refine((v) => !!bdMobile(v), 'Enter a valid Bangladeshi mobile number (01XXXXXXXXX)'),
})

/** POST /api/v1/patient/register-google — step 2 of "Continue with Google": the Google account is proven by the signed cookie. */
export const POST = publicRoute(async ({ req }) => {
  const jar = await cookies()
  const g = await readSignup(jar.get(SIGNUP_COOKIE)?.value)
  if (!g) throw new ApiError(400, 'SIGNUP_EXPIRED', 'Your Google sign-in expired. Please continue with Google again.')
  const input = await body(req, Input)
  const p = await registerPatientWithGoogle({ ...input, google: g }, { ...clientMeta(req), client: 'portal' })
  jar.delete(SIGNUP_COOKIE)
  const { token, expiresAt } = await issuePatientToken(String(p._id), Number(p.passwordVersion ?? 0))
  jar.set(patientCookie(token, expiresAt))
  return { ok: true, redirect: '/my' }
})
