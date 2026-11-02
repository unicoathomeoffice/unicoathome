import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { BillingStatusInput, setBillingStatus } from '@/lib/services/billing'

/** POST /api/v1/requests/:id/bills/status { status | null } — override (e.g. WAIVED) or go back to automatic. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    await setBillingStatus(r, (await body(req, BillingStatusInput)).status, user, clientMeta(req, user))
    return { ok: true, status: r.billing.status }
  },
  { perm: 'billing.invoice' },
)
