import { route, body, clientMeta } from '@/lib/api'
import { loadRequest, tickChecklist, ChecklistInput } from '@/lib/services/requests'
import { plain } from '@/lib/db'

/** PATCH /api/v1/requests/:id/checklist/:key { done, note?, reason?, deviceAt? } */
export const PATCH = route<{ id: string; key: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const item = await tickChecklist(r, params.key, await body(req, ChecklistInput), user, clientMeta(req, user))
  return { ok: true, item: plain(item) }
})
