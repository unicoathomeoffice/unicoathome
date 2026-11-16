import { route, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { H360Error } from '@/lib/h360'
import { h360Address, h360Profile } from '@/lib/h360-patient'

export const maxDuration = 30

/** GET /api/v1/h360/patients/:uhid — the patient's present address from H360's "View Patient Information" (read-only).
 *  H360's search rows only carry thana / district ID numbers, so New request asks here when a record is used. */
export const GET = route<{ uhid: string }>(async ({ user, params }) => {
  if (!can(user, 'requests.create') && !can(user, 'requests.readAll')) throw forbidden()
  const uhid = decodeURIComponent(params.uhid ?? '').trim()
  if (!/^[\w-]{3,30}$/.test(uhid)) return { found: false, address: null }
  try {
    const p = await h360Profile(uhid)
    return { found: !!p, address: h360Address(p?.presentAddress) }
  } catch (e) {
    if (e instanceof H360Error) return { found: false, address: null, offline: true }
    throw e
  }
})
