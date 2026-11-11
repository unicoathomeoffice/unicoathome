import { route, body, clientMeta } from '@/lib/api'
import { ReceiveInput, receiveItems } from '@/lib/services/stock'

/** POST { items: [{ itemId, qty }], from?, ref?, note? } — several items received at once (H360 indent, supplier). */
export const POST = route(async ({ req, user }) => receiveItems(await body(req, ReceiveInput), user, clientMeta(req, user)), { perm: 'store.manage' })
