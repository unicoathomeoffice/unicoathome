import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { BATCH_RX } from '@/lib/wa/context'
import { approve, discard, forceSend, listPending, pendingCount, retryFailed } from '@/lib/wa/outbox'

export const maxDuration = 60 // "Send now" waits for the send session

/** GET — WhatsApp messages waiting for approval. ?batch= one click's messages · ?count=1 just the number. */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    if (q.get('count')) return { count: await pendingCount() }
    const batch = q.get('batch')
    const items = await listPending({ batch: batch && BATCH_RX.test(batch) ? batch : null, requestId: q.get('requestId') })
    return { items, count: batch ? items.length : await pendingCount() }
  },
  { perm: 'messages.approve' },
)

const Action = z.object({
  action: z.enum(['send', 'discard', 'retry', 'force']), // retry: failed back into the queue · force: send now
  ids: z.union([z.array(z.string().regex(/^[a-f0-9]{24}$/i)).min(1).max(500), z.literal('ALL')]),
  batch: z.string().regex(BATCH_RX).optional(), // with ids 'ALL': only this click's messages
  edits: z.record(z.string(), z.string().trim().min(1, 'The message is empty').max(1500)).optional(), // id → new text
})

/** POST { action: 'send' | 'discard' | 'retry', ids | 'ALL', batch?, edits? } */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, Action)
    const meta = clientMeta(req, user)
    if (input.action === 'force') return { ok: true, ...(await forceSend(input.ids === 'ALL' ? [] : input.ids, user, meta)) }
    if (input.action === 'retry') return { ok: true, count: input.ids === 'ALL' ? 0 : await retryFailed(input.ids, user, meta) }
    const count = input.action === 'send' ? await approve(input.ids, user, { edits: input.edits, batch: input.batch }, meta) : await discard(input.ids, user, { batch: input.batch }, meta)
    return { ok: true, count }
  },
  { perm: 'messages.approve' },
)
