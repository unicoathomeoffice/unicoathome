import { z } from 'zod'
import { route, body, clientMeta, notFound } from '@/lib/api'
import { editPending } from '@/lib/wa/outbox'

const Patch = z.object({ text: z.string().trim().min(1, 'The message is empty').max(1500) })

/** PATCH { text } — change a waiting message before it is sent. */
export const PATCH = route<{ id: string }>(
  async ({ req, user, params }) => {
    const { text } = await body(req, Patch)
    const m = await editPending(params.id, text, user, clientMeta(req, user))
    if (!m) throw notFound('Waiting message')
    return { ok: true, text: m.renderedText }
  },
  { perm: 'messages.approve' },
)
