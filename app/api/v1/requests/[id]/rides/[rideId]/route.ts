import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { removeRide, RidePatch, updateRide } from '@/lib/services/rides'

export const maxDuration = 60

/** PATCH — fill in the fare / add screenshots later (the claim line and the PDF follow). */
export const PATCH = route<{ id: string; rideId: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  await updateRide(r, params.rideId, await body(req, RidePatch), user, clientMeta(req, user))
  return { ok: true }
})

/** DELETE — remove the ride (and its line from the payer's draft claim). */
export const DELETE = route<{ id: string; rideId: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  await removeRide(r, params.rideId, user, clientMeta(req, user))
  return { ok: true }
})
