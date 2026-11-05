import { z } from 'zod'
import { route, body, clientMeta, bad } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { applyRebill } from '@/lib/services/h360-bills'
import { H360Error } from '@/lib/h360'

const RebillInput = z.object({ invoiceNo: z.string().regex(/^\d{4,7}$/, 'H360 invoice no'), mode: z.enum(['replace', 'add', 'dismiss']) })

/** POST /api/v1/requests/:id/bills/:invoiceId/rebill — the counter re-billed in H360: replace / add the paid bill, or dismiss. */
export const POST = route<{ id: string; invoiceId: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    try {
      return await applyRebill(r, params.invoiceId, await body(req, RebillInput), user, clientMeta(req, user))
    } catch (e) {
      if (e instanceof H360Error) throw bad(e.code === 'AUTH' ? 'H360 sign-in failed — check Settings → Integrations' : 'H360 is not answering right now')
      throw e
    }
  },
  { perm: 'billing.invoice' },
)
