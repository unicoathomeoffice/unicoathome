import { route, body, clientMeta } from '@/lib/api'
import { actsForTeam, loadRequest } from '@/lib/services/requests'
import { PackInput, packKit } from '@/lib/services/kit'

/** PATCH /api/v1/requests/:id/kit/:itemId { packedQty } — the bag check before the journey. */
export const PATCH = route<{ id: string; itemId: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return packKit(r, params.itemId, await body(req, PackInput), user, { actsForTeam: actsForTeam(user, r) }, clientMeta(req, user))
})
