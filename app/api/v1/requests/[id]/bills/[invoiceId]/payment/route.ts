import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { markInvoicePaid, PaymentInput } from '@/lib/services/billing'

/** POST /api/v1/requests/:id/bills/:invoiceId/payment — paid at the counter: in full (no amount) or an amount, + receipt / MR no. */
export const POST = route<{ id: string; invoiceId: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    return markInvoicePaid(r, params.invoiceId, await body(req, PaymentInput), user, clientMeta(req, user))
  },
  { perm: 'billing.invoice' },
)
