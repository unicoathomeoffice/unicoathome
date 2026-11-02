import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { InvoicePatch, removeInvoice, updateInvoice } from '@/lib/services/billing'

/** PATCH /api/v1/requests/:id/bills/:invoiceId — edit amounts (e.g. the patient paid the due). */
export const PATCH = route<{ id: string; invoiceId: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    await updateInvoice(r, params.invoiceId, await body(req, InvoicePatch), user, clientMeta(req, user))
    return { ok: true, status: r.billing.status }
  },
  { perm: 'billing.invoice' },
)

/** DELETE /api/v1/requests/:id/bills/:invoiceId — unlink an invoice from the visit. */
export const DELETE = route<{ id: string; invoiceId: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    await removeInvoice(r, params.invoiceId, user, clientMeta(req, user))
    return { ok: true, status: r.billing.status }
  },
  { perm: 'billing.invoice' },
)
