import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { syncInbox } from '@/lib/wa/service'

export const maxDuration = 60

const Input = z.object({ manual: z.boolean().optional() })

/**
 * POST { manual? } — collect new WhatsApp messages and delivered / read ticks (a ~15 s session).
 * The open WhatsApp page calls it every ~2 minutes; one session per 110 s for everyone (20 s for "Check now").
 */
export const POST = route(
  async ({ req, user }) => {
    const { manual } = await body(req, Input)
    const r = await syncInbox({ minGapMs: manual ? 20_000 : 110_000 })
    if (manual) await audit(user, 'whatsapp.sync', 'message', null, { after: { changed: r.changed, received: r.received, ok: r.ok, skipped: r.skipped ?? null } }, clientMeta(req, user))
    return { ...r, at: new Date().toISOString() }
  },
  { perm: 'messages.approve' },
)
