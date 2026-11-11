import { route, body, clientMeta, bad } from '@/lib/api'
import { isOid } from '@/lib/models'
import { correctMove, CorrectMoveInput } from '@/lib/services/stock'

/** PATCH { qty, why } — correct a wrong opening / received / adjustment entry (a correction move puts the stock right). */
export const PATCH = route<{ id: string; moveId: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id) || !isOid(params.moveId)) throw bad('Invalid entry')
    return correctMove(params.id, params.moveId, await body(req, CorrectMoveInput), user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)
