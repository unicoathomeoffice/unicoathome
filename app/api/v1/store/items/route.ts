import { route, body, clientMeta, forbidden } from '@/lib/api'
import { can } from '@/lib/constants'
import { createStoreItems, NewItemsInput } from '@/lib/services/store-items'

/** POST { items: [...] } — add one or many items to the store (H360 list, copy, bulk paste / CSV, by hand). */
export const POST = route(async ({ req, user }) => {
  if (!can(user, 'store.manage') && !can(user, 'master.manage')) throw forbidden()
  return createStoreItems(await body(req, NewItemsInput), user, clientMeta(req, user))
})
