import { route, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { syncInbox } from '@/lib/wa/service'

export const maxDuration = 60

/** POST — older name of /whatsapp/sync (manual check): new messages and delivered / read ticks. */
export const POST = route(
  async ({ req, user }) => {
    const r = await syncInbox({ minGapMs: 20_000 })
    await audit(user, 'whatsapp.sync', 'message', null, { after: { changed: r.changed, received: r.received, ok: r.ok, skipped: r.skipped ?? null } }, clientMeta(req, user))
    return { ...r, receiptsAt: new Date().toISOString() }
  },
  { perm: 'messages.approve' },
)
