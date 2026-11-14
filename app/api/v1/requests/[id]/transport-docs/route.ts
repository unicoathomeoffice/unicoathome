import { route, clientMeta, bad, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { loadRequest } from '@/lib/services/requests'
import { sendTransportDocs } from '@/lib/services/transport-docs'

export const maxDuration = 60

/** POST /api/v1/requests/:id/transport-docs — rebuild and resend the car requisition (+ gate pass once a car is allotted). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'requests.manage') && !can(user, 'transport.manage')) throw forbidden()
  const r = await loadRequest(params.id, user)
  if (!r.transport?.needed) throw bad('This visit does not need a Unico car')
  if (!r.assignment?.primaryStaffId) throw bad('Assign the care team first: the requisition names who travels')
  const out = await sendTransportDocs(r._id, r.transport.vehicleId ? 'allotted' : 'requested', user.id)
  await audit(user, 'transport.docs_send', 'request', r._id, { after: out, label: r.requestNo }, clientMeta(req, user))
  return out
})
