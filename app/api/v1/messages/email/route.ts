import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { Patient } from '@/lib/models'
import { loadRequest, templateVars } from '@/lib/services/requests'
import { queueEmail, renderTemplate, emailConfigured } from '@/lib/messaging'
import { audit } from '@/lib/audit'

const Input = z.object({
  requestId: z.string().optional(),
  templateKey: z.string().optional(),
  to: z.string().email().optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
})

/** POST /api/v1/messages/email — send a template (or free text) email, logged in message_logs. */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, Input)
    const r = input.requestId ? await loadRequest(input.requestId, user) : null
    let to = input.to
    let toName: string | undefined
    if (!to && r) {
      const p = await Patient.findById(r.patientId).select('email name consent').lean<any>()
      if (!p?.email) throw bad('This patient has no email address')
      if (p.consent?.email === false) throw forbidden('Patient has not consented to email')
      to = p.email
      toName = p.name
    }
    if (!to) throw bad('Recipient email is required')
    let subject = input.subject
    let text = input.text
    if (input.templateKey && r) {
      const t = await renderTemplate(input.templateKey, await templateVars(r, r.assignment?.primaryStaffId))
      subject ??= t.subject
      text ??= t.text
    }
    if (!subject || !text) throw bad('Subject and message are required')
    const log = await queueEmail({ to, toName, subject, text, templateKey: input.templateKey, requestId: r?._id, patientId: r?.patientId, initiatedBy: user.id })
    await audit(user, 'message.email_send', 'message', log._id, { after: { to, subject }, label: r?.requestNo }, clientMeta(req, user))
    return { id: String(log._id), configured: emailConfigured() }
  },
  { perm: 'messages.send' },
)
