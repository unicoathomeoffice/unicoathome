import { route, body, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { loadRequest } from '@/lib/services/requests'
import { buildVisitUpdate, sendVisitUpdate, SendUpdateInput } from '@/lib/services/updates'

export const maxDuration = 60

/** GET /api/v1/requests/:id/update — the generated short visit update (text only). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  const [staff, patient] = await Promise.all([buildVisitUpdate(r._id), buildVisitUpdate(r._id, { forPatient: true })])
  return { text: staff.text, patientText: patient.text, sentAt: r.visit?.updateSentAt ?? null }
})

/** POST /api/v1/requests/:id/update { hods, extra, staff, patient } — send it on WhatsApp now. */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    const r = await loadRequest(params.id, user)
    const pick = await body(req, SendUpdateInput)
    const out = await sendVisitUpdate(r._id, 'manual', pick, user.id)
    await audit(user, 'message.visit_update', 'request', r._id, { after: { ...pick, sent: out.sent }, label: r.requestNo }, clientMeta(req, user))
    return out
  },
  { perm: 'messages.send' },
)
