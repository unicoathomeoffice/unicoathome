import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { addRide, RideInput } from '@/lib/services/rides'

export const maxDuration = 60

/** POST /api/v1/requests/:id/rides — an own ride (Uber / Pathao …) with screenshots, any time after the visit. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return addRide(r, await body(req, RideInput), user, clientMeta(req, user))
})
