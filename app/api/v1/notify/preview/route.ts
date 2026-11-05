import { route, body, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { loadRequest } from '@/lib/services/requests'
import { notifyOptions, NotifyPreviewInput } from '@/lib/services/notify'

/**
 * POST /api/v1/notify/preview {events, requestId? | serviceCodes + patient, staffIds?, vehicleId?, driverId?}
 * → { paired, items[] }: who would get a WhatsApp for this action, the Settings defaults pre-ticked ("Notify on WhatsApp").
 */
export const POST = route(async ({ req, user }) => {
  if (!['requests.create', 'requests.manage', 'requests.assign', 'transport.manage'].some((p) => can(user, p as any))) throw forbidden()
  const input = await body(req, NotifyPreviewInput)
  const r = input.requestId ? await loadRequest(input.requestId, user) : null
  return notifyOptions(input, r ? r.toObject?.() ?? r : undefined)
})
