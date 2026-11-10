import { route, body, clientMeta } from '@/lib/api'
import { actsForTeam, loadRequest } from '@/lib/services/requests'
import { ConsumablesInput, saveConsumables } from '@/lib/services/kit'

/** PUT /api/v1/requests/:id/consumables { items: [{ itemId, qty }] } — what the visit used (catalog items). */
export const PUT = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return saveConsumables(r, await body(req, ConsumablesInput), user, { actsForTeam: actsForTeam(user, r) }, clientMeta(req, user))
})
