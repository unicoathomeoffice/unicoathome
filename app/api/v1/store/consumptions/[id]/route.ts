import { z } from 'zod'
import { route, body, clientMeta, bad } from '@/lib/api'
import { isOid } from '@/lib/models'
import { voidConsumption } from '@/lib/services/store-consumption'

/** POST { action: 'void', reason } — undo a consumption entered by mistake (stock goes back, the entry stays). */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw bad('Invalid consumption')
    const input = await body(req, z.object({ action: z.literal('void'), reason: z.string().trim().min(3, 'Say why').max(200) }))
    return voidConsumption(params.id, input.reason, user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)
