import { z } from 'zod'
import { route, body, bad, clientMeta } from '@/lib/api'
import { Patient } from '@/lib/models'
import { loadRequest } from '@/lib/services/requests'
import { prepareWhatsApp, queueEmail } from '@/lib/messaging'
import { isPaired } from '@/lib/wa/auth-state'
import { queueWhatsApp } from '@/lib/wa/service'
import { audit } from '@/lib/audit'

export const maxDuration = 60

const Input = z.object({
  requestId: z.string(),
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  subject: z.string().trim().max(200).optional(),
  text: z.string().trim().min(1, 'Write a message').max(4000),
})

/** POST /api/v1/messages/custom — a free-text email / WhatsApp to the patient of a request (logged like every message). */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, Input)
    const r = await loadRequest(input.requestId, user)
    const p = await Patient.findById(r.patientId).select('name email phone whatsapp consent').lean<any>()
    if (!p) throw bad('Patient not found')
    const meta = clientMeta(req, user)
    if (input.channel === 'EMAIL') {
      if (!p.email) throw bad('This patient has no email address')
      if (p.consent?.email === false) throw bad('The patient opted out of email')
      const log = await queueEmail({ to: p.email, toName: p.name, subject: input.subject || `Unico Hospitals · Home care ${r.requestNo}`, text: input.text, templateKey: 'custom', requestId: r._id, patientId: r.patientId, initiatedBy: user.id })
      await audit(user, 'message.custom', 'request', r._id, { after: { channel: 'EMAIL', to: p.email }, label: r.requestNo }, meta)
      return { ok: true, channel: 'EMAIL', id: String(log._id) }
    }
    if (p.consent?.whatsapp === false) throw bad('The patient opted out of WhatsApp')
    const to = p.whatsapp || p.phone
    if (await isPaired()) {
      const log = await queueWhatsApp({ to, toName: p.name, text: input.text, templateKey: 'custom', requestId: r._id, patientId: r.patientId, initiatedBy: user.id })
      await audit(user, 'message.custom', 'request', r._id, { after: { channel: 'WHATSAPP', to, auto: true }, label: r.requestNo }, meta)
      return { ok: true, channel: 'WHATSAPP', id: String(log._id), auto: true }
    }
    // no live WhatsApp session: hand the staff member a pre-filled wa.me link, logged as PREPARED
    const prepared = await prepareWhatsApp({ to, toName: p.name, text: input.text, templateKey: 'custom', requestId: r._id, patientId: r.patientId, initiatedBy: user.id })
    await audit(user, 'message.custom', 'request', r._id, { after: { channel: 'WHATSAPP', to, auto: false }, label: r.requestNo }, meta)
    return { ok: true, channel: 'WHATSAPP', id: prepared.logId, auto: false, url: prepared.url }
  },
  { perm: 'messages.send' },
)
