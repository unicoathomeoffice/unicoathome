import { route, body, clientMeta, bad } from '@/lib/api'
import { isOid } from '@/lib/models'
import { changeStock, stockHistory, StockInput } from '@/lib/services/stock'

/** GET — the item's last store moves (opening, received, used on visits, counts). */
export const GET = route<{ id: string }>(
  async ({ params }) => {
    if (!isOid(params.id)) throw bad('Invalid item')
    return { items: await stockHistory(params.id) }
  },
  { perm: 'requests.manage' },
)

/** POST { action: 'receive', qty, note? } new stock in · { action: 'count', qty, note? } stock-take sets the count. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw bad('Invalid item')
    return changeStock(params.id, await body(req, StockInput), user, clientMeta(req, user))
  },
  { perm: 'store.manage' },
)
