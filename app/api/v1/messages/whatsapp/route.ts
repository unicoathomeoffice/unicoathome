import { z } from 'zod'
import { route, body, bad, forbidden, clientMeta } from '@/lib/api'
import { Patient, User } from '@/lib/models'
import { loadRequest, templateVars } from '@/lib/services/requests'
import { prepareWhatsApp, renderTemplate } from '@/lib/messaging'
import { audit } from '@/lib/audit'

const Input = z.object({
  requestId: z.string().optional(),
  patientId: z.string().optional(),
  templateKey: z.string().optional(),
  to: z.enum(['patient', 'staff', 'custom']).default('patient'),
  staffId: z.string().optional(),
  phone: z.string().optional(),
  text: z.string().optional(), // free text (overrides template)
})

/**
 * POST /api/v1/messages/whatsapp — render a template for a record and return a wa.me link.
 * The client opens the link, the user taps Send in WhatsApp, then PATCH /messages/:logId {status:'SENT_CONFIRMED'}.
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
      const vars = await templateVars(r, r.assignment?.primaryStaffId)
      text = (await renderTemplate(input.templateKey, vars)).text
    }
    const out = await prepareWhatsApp({ to: phone, toName, text, templateKey: input.templateKey, requestId: r?._id, patientId: patient?._id, initiatedBy: user.id })
    await audit(user, 'message.whatsapp_prepare', 'message', out.logId, { after: { to: out.to, templateKey: input.templateKey, requestNo: r?.requestNo }, label: toName }, clientMeta(req, user))
    return out
  },
  { perm: 'messages.send' },
)
