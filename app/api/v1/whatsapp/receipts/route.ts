import { route, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { syncReceipts } from '@/lib/wa/service'

export const maxDuration = 60

/** POST — collect the delivered / read ticks now ("Update ticks" in the WhatsApp inbox). */
export const POST = route(
  async ({ req, user }) => {
    const r = await syncReceipts()
    await audit(user, 'whatsapp.receipts', 'message', null, { after: { changed: r.changed, ok: r.ok, skipped: r.skipped ?? null } }, clientMeta(req, user))
    return { ...r, receiptsAt: new Date().toISOString() }
  },
  { perm: 'messages.approve' },
)
