import { route, body, clientMeta } from '@/lib/api'
import { loadRequest } from '@/lib/services/requests'
import { AfterTickInput, tickAfter } from '@/lib/services/after-checklist'

/** PATCH /api/v1/requests/:id/after-checklist/:key { done, note?, reason? } — after-return item (e.g. samples handed to the lab). */
export const PATCH = route<{ id: string; key: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  return tickAfter(r, params.key, await body(req, AfterTickInput), user, clientMeta(req, user))
})
