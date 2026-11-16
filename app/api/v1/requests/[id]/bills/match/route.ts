import { route, body, clientMeta, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { loadRequest } from '@/lib/services/requests'
import { applyBillMatch, billMatch, BillMatchInput } from '@/lib/services/bill-match'

/** GET /api/v1/requests/:id/bills/match — invoice lines the request does not have, and tests nobody billed. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  return billMatch(r)
})

/** POST /api/v1/requests/:id/bills/match { add: [names], remove: [names] } — make the request match the bill
 *  (waiting WhatsApp messages for it are rewritten with the new tests). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'billing.invoice') && !can(user, 'requests.manage')) throw forbidden()
  const r = await loadRequest(params.id, user)
  return applyBillMatch(r, await body(req, BillMatchInput), user, clientMeta(req, user))
})
