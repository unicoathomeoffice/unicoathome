import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { Patient, User } from '@/lib/models'
import { loadRequest, templateVars } from '@/lib/services/requests'
import { prepareWhatsApp, renderTemplate, waNumber } from '@/lib/messaging'
import { isPaired } from '@/lib/wa/status'
import { date as fmtDate, dhakaDate } from '@/lib/format'
import { audit } from '@/lib/audit'

const Input = z.object({
  requestId: z.string().optional(),
  patientId: z.string().optional(),
  templateKey: z.string().optional(),
  to: z.enum(['patient', 'staff', 'custom']).default('patient'),
  staffId: z.string().optional(),
  phone: z.string().optional(),
  text: z.string().optional(), // free text (overrides template)
  /** 'auto': send from the paired hospital number (falls back to a link when not paired); 'link' (default): wa.me link */
  mode: z.enum(['auto', 'link']).default('link'),
  /** only render the message (no log, no send) — for previews; date/slot override the request's for a confirm preview */
  preview: z.boolean().optional(),
  date: z.string().optional(),
  slot: z.string().optional(),
})

/**
 * POST /api/v1/messages/whatsapp — render a template for a record and send it.
 * mode 'auto' + paired WhatsApp: queued and sent from the hospital number ({ auto: true }).
 * Otherwise a wa.me link is returned; the user taps Send in WhatsApp, then PATCH /messages/:logId {status:'SENT_CONFIRMED'}.
 * preview: just the rendered text.
 */
export const POST = route(
  async ({ req, user }) => {
    const input = await body(req, Input)
    let r: any = null
    if (input.requestId) r = await loadRequest(input.requestId, user)
    const patient = r ? await Patient.findById(r.patientId).lean<any>() : input.patientId ? await Patient.findById(input.patientId).lean<any>() : null
    let phone = input.phone
    let toName: string | undefined
    if (input.to === 'patient') {
      if (!patient) throw bad('Patient not found')
      if (patient.consent?.whatsapp === false) throw forbidden('Patient has not consented to WhatsApp messages')
      phone = patient.phone
      toName = patient.name
    } else if (input.to === 'staff') {
      const s = await User.findById(input.staffId ?? r?.assignment?.primaryStaffId).select('name whatsapp phone').lean<any>()
      if (!s) throw bad('Staff member not found')
      phone = s.whatsapp || s.phone
      toName = s.name
    }
    if (!phone) throw bad('No phone number')
    let text = input.text
    if (!text) {
      if (!input.templateKey || !r) throw bad('Choose a template or type a message')
      const vars: Record<string, unknown> = await templateVars(r, r.assignment?.primaryStaffId)
      if (input.date) vars.date = fmtDate(dhakaDate(input.date))
      if (input.slot) vars.slot = input.slot
      text = (await renderTemplate(input.templateKey, vars)).text
    }
    if (input.preview) return { text, to: waNumber(phone), toName }
    if (input.mode === 'auto' && (await isPaired())) {
      const { queueWhatsApp } = await import('@/lib/wa/service') // Baileys loads only when actually sending
      const log = await queueWhatsApp({ to: phone, toName, text, templateKey: input.templateKey, requestId: r?._id, patientId: patient?._id, initiatedBy: user.id })
      await audit(user, 'message.whatsapp_send', 'message', log._id, { after: { to: log.to, templateKey: input.templateKey, requestNo: r?.requestNo }, label: toName }, clientMeta(req, user))
      return { auto: true, logId: String(log._id), to: log.to, text }
    }
    const out = await prepareWhatsApp({ to: phone, toName, text, templateKey: input.templateKey, requestId: r?._id, patientId: patient?._id, initiatedBy: user.id })
    await audit(user, 'message.whatsapp_prepare', 'message', out.logId, { after: { to: out.to, templateKey: input.templateKey, requestNo: r?.requestNo }, label: toName }, clientMeta(req, user))
    return { ...out, auto: false }
  },
  { perm: 'messages.send' },
)
