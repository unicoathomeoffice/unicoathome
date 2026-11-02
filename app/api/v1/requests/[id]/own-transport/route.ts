import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { giveOwnTransportCash, OwnTransportInput } from '@/lib/services/pettycash'

export const maxDuration = 60 // voucher PDF + WhatsApp go out after the response

/** POST — no hospital car: own transport (Uber / Pathao / CNG…) + petty cash approved at once, with a voucher. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const input = await body(req, OwnTransportInput)
  return giveOwnTransportCash(r, input, user, clientMeta(req, user))
})
