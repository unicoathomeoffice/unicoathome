import { route, body, clientMeta } from '@/lib/api'
import { plain } from '@/lib/db'
import { loadRequest } from '@/lib/services/requests'
import { addInvoice, InvoiceInput } from '@/lib/services/billing'

/** GET /api/v1/requests/:id/bills — invoices + payment status of a visit. */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  const b = r.billing ?? {}
  return plain({ status: b.status ?? null, override: b.statusOverride ?? null, paid: b.paidAmount ?? 0, due: b.dueAmount ?? 0, payable: b.invoiceAmount ?? 0, invoices: b.invoices ?? [] })
})

/** POST /api/v1/requests/:id/bills — add an invoice (uploaded file and/or amounts, or from H360). */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    await addInvoice(r, await body(req, InvoiceInput), user, clientMeta(req, user))
    return { ok: true, status: r.billing.status }
  },
  { perm: 'billing.invoice' },
)
