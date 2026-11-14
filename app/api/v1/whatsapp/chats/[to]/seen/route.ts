import { route, bad, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { MessageLog } from '@/lib/models'
import { chatKey } from '@/lib/wa/history'

/** POST — mark this chat's incoming messages as seen in our inbox (nothing is sent to WhatsApp: no blue ticks). */
export const POST = route<{ to: string }>(
  async ({ req, user, params }) => {
    const to = chatKey(decodeURIComponent(params.to))
    if (to.length < 6) throw bad('Invalid chat')
    const r = await MessageLog.updateMany({ channel: 'WHATSAPP', to, direction: 'IN', seenAt: null }, { $set: { seenAt: new Date() } })
    if (r.modifiedCount) await audit(user, 'whatsapp.seen', 'message', null, { after: { to, count: r.modifiedCount } }, clientMeta(req, user))
    return { ok: true, count: r.modifiedCount }
  },
  { perm: 'messages.approve' },
)
