import { route, body, clientMeta } from '@/lib/api'
import { updateNote, deleteNote, NotePatch } from '@/lib/services/notes'

/** PATCH /api/v1/notes/:id — author only */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  const input = await body(req, NotePatch)
  await updateNote(params.id, input, user, clientMeta(req, user))
  return { ok: true }
})

/** DELETE /api/v1/notes/:id — author only, soft delete */
export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  await deleteNote(params.id, user, clientMeta(req, user))
  return { ok: true }
})
