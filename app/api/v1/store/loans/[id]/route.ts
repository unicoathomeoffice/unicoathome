import { route, body, clientMeta, bad } from '@/lib/api'
import { isOid } from '@/lib/models'
import { editLoan, LoanAction, loanAction, LoanEdit } from '@/lib/services/store-loans'

/** POST { action: 'return', items, note? } · { action: 'writeoff', reason } · { action: 'undo-return', index, reason } · { action: 'reopen', reason } */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw bad('Invalid loan')
    return loanAction(params.id, await body(req, LoanAction), user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)

/** PATCH { partner, items, dueAt?, note?, requestNo?, why } — correct a loan (stock put right, change logged). */
export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw bad('Invalid loan')
    return editLoan(params.id, await body(req, LoanEdit), user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)
