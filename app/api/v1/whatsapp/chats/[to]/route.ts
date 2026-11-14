import { z } from 'zod'
import { route, body, bad, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { chatKey, chatThread } from '@/lib/wa/history'
import { queueWhatsApp } from '@/lib/wa/service'

/** GET ?before= — one chat (a person, group g:… or hidden number lid:…), oldest → newest, 50 at a time. */
export const GET = route<{ to: string }>(
  async ({ req, params }) => {
    const to = chatKey(decodeURIComponent(params.to))
    if (to.length < 8) throw bad('Invalid number')
    return chatThread(to, { before: req.nextUrl.searchParams.get('before') })
  },
  { perm: 'messages.approve' },
)

const Compose = z.object({ text: z.string().trim().min(1, 'Write a message').max(1500) })

/** POST { text } — a message typed by an admin to this chat (typing it is the approval, so it goes straight out). */
export const POST = route<{ to: string }>(
  async ({ req, user, params }) => {
    const to = chatKey(decodeURIComponent(params.to))
    if (to.length < 8) throw bad('Invalid number')
    const { text } = await body(req, Compose)
    const { contact } = await chatThread(to, { limit: 1 })
    const log = await queueWhatsApp({ to, toName: /^\+|^WhatsApp (group|contact)$/.test(contact.name) ? undefined : contact.name, text, templateKey: 'custom', initiatedBy: user.id, approved: true })
    await audit(user, 'message.compose', 'message', log._id, { after: { to, toName: contact.name, text: text.slice(0, 200), status: log.status }, label: contact.name }, clientMeta(req, user))
    return { ok: true, id: String(log._id), status: log.status as string, error: (log.error as string) ?? null }
  },
  { perm: 'messages.approve' },
)
