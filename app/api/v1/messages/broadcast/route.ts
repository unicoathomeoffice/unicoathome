import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { ROLES, can } from '@/lib/constants'
import { User, isOid } from '@/lib/models'
import { notifyUsers, queueEmail } from '@/lib/messaging'
import { isPaired } from '@/lib/wa/auth-state'
import { queueWhatsApp } from '@/lib/wa/service'
import { audit } from '@/lib/audit'

export const maxDuration = 60

const Input = z.object({
  roles: z.array(z.enum(ROLES)).default([]),
  userIds: z.array(z.string()).max(200).default([]),
  channels: z.array(z.enum(['inapp', 'email', 'whatsapp'])).min(1, 'Pick at least one channel'),
  title: z.string().trim().min(2, 'Enter a title').max(120),
  text: z.string().trim().min(1, 'Write a message').max(4000),
})

/** POST /api/v1/messages/broadcast — a custom message to staff groups and/or individuals (in-app, email, WhatsApp). */
export const POST = route(
  async ({ req, user }) => {
    if (!can(user, 'requests.manage')) throw forbidden('Only coordinators and admins can broadcast')
    const input = await body(req, Input)
    const ids = input.userIds.filter(isOid)
    if (!input.roles.length && !ids.length) throw bad('Choose at least one group or person')
    const or: any[] = []
    if (input.roles.length) or.push({ role: { $in: input.roles } }, { roles: { $in: input.roles } })
    if (ids.length) or.push({ _id: { $in: ids } })
    const people = await User.find({ $or: or, status: 'ACTIVE', deletedAt: null }).select('name email phone whatsapp notificationPrefs').lean<any[]>()
    if (!people.length) throw bad('Nobody matches that selection')
    const counts = { people: people.length, inapp: 0, email: 0, whatsapp: 0, whatsappSkipped: 0 }
    if (input.channels.includes('inapp')) {
      await notifyUsers(
        people.map((p) => p._id),
        { type: 'BROADCAST', title: input.title, body: input.text, priority: 'high' },
      )
      counts.inapp = people.length
    }
    if (input.channels.includes('email')) {
      for (const p of people) {
        if (!p.email || p.notificationPrefs?.email === false) continue
        await queueEmail({ to: p.email, toName: p.name, subject: input.title, text: input.text, templateKey: 'broadcast', initiatedBy: user.id })
        counts.email++
      }
    }
    if (input.channels.includes('whatsapp')) {
      const live = await isPaired()
      for (const p of people) {
        const to = p.whatsapp || p.phone
        if (!to || p.notificationPrefs?.whatsapp === false) continue
        if (!live) {
          counts.whatsappSkipped++
          continue
        }
        await queueWhatsApp({ to, toName: p.name, text: `*${input.title}*\n${input.text}`, templateKey: 'broadcast', initiatedBy: user.id })
        counts.whatsapp++
      }
    }
    await audit(user, 'message.broadcast', 'message', 'broadcast', { after: { ...counts, roles: input.roles, channels: input.channels, title: input.title }, label: input.title }, clientMeta(req, user))
    return { ok: true, ...counts }
  },
  { perm: 'messages.send' },
)
