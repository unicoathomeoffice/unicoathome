import { z } from 'zod'
import { route, body, notFound, forbidden, clientMeta } from '@/lib/api'
import { MessageLog, isOid } from '@/lib/models'
import { deliverEmail } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'

export const GET = route<{ id: string }>(async ({ params }) => {
  if (!isOid(params.id)) throw notFound('Message')
  const m = await MessageLog.findById(params.id).lean()
  if (!m) throw notFound('Message')
  return { message: plain(m) }
})

const Patch = z.object({ status: z.enum(['SENT_CONFIRMED', 'FAILED']).optional(), resend: z.boolean().optional() })

/** PATCH /api/v1/messages/:id — WhatsApp "I sent it" confirmation, or resend a failed email. */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  if (!isOid(params.id)) throw notFound('Message')
  const m = await MessageLog.findById(params.id)
  if (!m) throw notFound('Message')
  const input = await body(req, Patch)
  if (input.status) {
    if (String(m.initiatedBy) !== user.id && !['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role)) throw forbidden()
    m.status = input.status
    m.events.push({ status: input.status, at: new Date() })
    await m.save()
    await audit(user, `message.${input.status.toLowerCase()}`, 'message', m._id, { after: { channel: m.channel, to: m.to }, label: m.templateKey }, clientMeta(req, user))
  }
  if (input.resend && m.channel === 'EMAIL') {
    if (!['SUPER_ADMIN', 'HC_ADMIN', 'FRONT_DESK'].includes(user.role)) throw forbidden()
    m.events.push({ status: 'QUEUED', at: new Date(), note: `Resent by ${user.name}` })
    await m.save()
    await deliverEmail(String(m._id))
    await audit(user, 'message.resend', 'message', m._id, { after: { to: m.to }, label: m.subject }, clientMeta(req, user))
  }
  return { message: plain(await MessageLog.findById(params.id).select('-renderedHtml').lean()) }
})
