import { route, body, clientMeta } from '@/lib/api'
import { decideApproval, DecideInput } from '@/lib/services/approvals'

/** PATCH /api/v1/approvals/:id { approve, note?, date?, slot? } — decides and executes the approval */
export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    const input = await body(req, DecideInput)
    return decideApproval(params.id, input, user, clientMeta(req, user))
  },
  { perm: 'approvals.decide' },
)
