import { cookies } from 'next/headers'
import { publicRoute } from '@/lib/api'
import { PATIENT_COOKIE } from '@/lib/patient-auth'

/** POST /api/v1/patient/logout */
export const POST = publicRoute(async () => {
  ;(await cookies()).delete(PATIENT_COOKIE)
  return { ok: true }
})
