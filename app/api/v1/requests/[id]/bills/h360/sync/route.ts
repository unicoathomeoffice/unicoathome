import { route, clientMeta, ApiError } from '@/lib/api'
import { H360Error } from '@/lib/h360'
import { loadRequest } from '@/lib/services/requests'
import { syncH360Bills } from '@/lib/services/h360-bills'

export const maxDuration = 60

/** POST /api/v1/requests/:id/bills/h360/sync — refresh paid / due of this visit's invoices from H360. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    try {
      return await syncH360Bills(r, user, clientMeta(req, user))
    } catch (e) {
      if (e instanceof H360Error) throw new ApiError(502, `H360_${e.code}`, e.message)
      throw e
    }
  },
  { perm: 'billing.invoice' },
)
