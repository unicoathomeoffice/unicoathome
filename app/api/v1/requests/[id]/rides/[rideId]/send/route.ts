import { route, clientMeta, forbidden, notFound } from '@/lib/api'
import { isCoordinator } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { loadRequest } from '@/lib/services/requests'
import { sendRideDocs } from '@/lib/services/rides'

export const maxDuration = 60

/** POST — make and send the ride PDF (requisition + screenshots) to the on-call security supervisor again. */
export const POST = route<{ id: string; rideId: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const ride = r.rides?.id(params.rideId)
  if (!ride) throw notFound('Ride')
  if (String(ride.userId) !== user.id && String(ride.addedBy) !== user.id && !isCoordinator(user)) throw forbidden()
  const out = await sendRideDocs(r._id, params.rideId, user.id)
  await audit(user, 'ride.send', 'request', r._id, { after: out, label: r.requestNo }, clientMeta(req, user))
  return out
})
