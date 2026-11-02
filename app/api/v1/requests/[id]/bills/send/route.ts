import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { sendInvoices, SendInvoicesInput } from '@/lib/services/billing'

export const maxDuration = 60

/** POST /api/v1/requests/:id/bills/send { invoiceIds, patient, staffIds } — bill PDFs on WhatsApp. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    return sendInvoices(r, await body(req, SendInvoicesInput), user, clientMeta(req, user))
  },
  { perm: 'billing.invoice' },
)
