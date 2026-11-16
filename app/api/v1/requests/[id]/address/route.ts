import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { addressStatus, changeVisitAddress, VisitAddressInput } from '@/lib/services/visit-address'

export const maxDuration = 30

/** GET /api/v1/requests/:id/address — the address on file and H360's present address for the UHID (differs = update?). */
export const GET = route<{ id: string }>(async ({ user, params }) => addressStatus(await loadRequest(params.id, user)))

/** POST /api/v1/requests/:id/address { address, otherOpen, source } — change the patient's address after the request was
 *  made: the patient record (history kept), this visit and, optionally, their other open visits. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return changeVisitAddress(r, await body(req, VisitAddressInput), user, clientMeta(req, user))
})
