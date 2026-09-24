import { route, body, clientMeta, qp } from '@/lib/api'
import { plain } from '@/lib/db'
import { listNotes, createNote, NoteInput } from '@/lib/services/notes'

/** GET /api/v1/notes?filter=mine|patient|handover|flagged&requestId=&patientId=&q=&limit= — only notes the user may see */
export const GET = route(async ({ req, user }) => {
  const p = qp(req)
  const items = await listNotes(user, {
    filter: p.get('filter') ?? undefined,
    requestId: p.get('requestId') ?? undefined,
    patientId: p.get('patientId') ?? undefined,
    q: p.get('q') ?? undefined,
    limit: Number(p.get('limit') ?? 100),
  })
  return { items: plain(items) }
})

/** POST /api/v1/notes {type, text, patientId?, requestId?, tags, visibility} */
export const POST = route(async ({ req, user }) => {
  const input = await body(req, NoteInput)
  const n = await createNote(input, user, clientMeta(req, user))
  return { id: String(n._id) }
})
