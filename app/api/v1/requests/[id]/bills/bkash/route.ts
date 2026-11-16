import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { sendBkashQr, SendBkashInput } from '@/lib/services/billing'

export const maxDuration = 60

/** POST /api/v1/requests/:id/bills/bkash { invoiceIds, amount?, patient, other?, saveAsWhatsApp? } — the hospital's bKash
 *  QR picture and the amount to pay on WhatsApp (waits in the Outbox for approval; nothing is marked paid). */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    return sendBkashQr(r, await body(req, SendBkashInput), user, clientMeta(req, user))
  },
  { perm: 'billing.invoice' },
)
