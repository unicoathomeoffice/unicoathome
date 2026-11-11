import { route, body, clientMeta, bad } from '@/lib/api'
import { isOid } from '@/lib/models'
import { LoanAction, loanAction } from '@/lib/services/store-loans'

/** POST { action: 'return', items: [{ itemId, qty }], note? } · { action: 'writeoff', reason } */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw bad('Invalid loan')
    return loanAction(params.id, await body(req, LoanAction), user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)
