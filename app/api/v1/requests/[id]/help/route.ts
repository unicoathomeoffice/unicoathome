import { z } from 'zod'
import { route, body, clientMeta } from '@/lib/api'
import { User, MessageLog } from '@/lib/models'
import { loadRequest } from '@/lib/services/requests'
import { onCallSupervisors } from '@/lib/services/transport-docs'
import { getSettings } from '@/lib/settings'
import { notifyUsers, waNumber } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { ageGender, time as fmtTime } from '@/lib/format'

export const maxDuration = 60

type Person = { id?: string; name: string; phone: string; role: string }

/** Who answers a call for help on this visit: the coordinators (the one who assigned / created it first), the
 *  security supervisors on call, the hospital's front desk and 999. */
async function contacts(r: any): Promise<{ coordinators: Person[]; security: Person[]; hospital: string | null; emergency: string }> {
  const s = await getSettings()
  const first = [r.assignment?.assignedBy, r.createdBy].filter(Boolean).map(String)
  const desk = await User.find({ status: 'ACTIVE', deletedAt: null, $or: [{ role: { $in: ['HC_ADMIN'] } }, { roles: 'HC_ADMIN' }, { _id: { $in: first } }] })
    .select('name phone whatsapp role roles')
    .lean<any[]>()
  const coordinators = desk
    .filter((u) => waNumber(u.whatsapp || u.phone) && (u.role === 'HC_ADMIN' || (u.roles ?? []).includes('HC_ADMIN') || first.includes(String(u._id))))
    .sort((a, b) => (first.includes(String(b._id)) ? 1 : 0) - (first.includes(String(a._id)) ? 1 : 0))
    .slice(0, 6)
    .map((u) => ({ id: String(u._id), name: u.name, phone: u.whatsapp || u.phone, role: 'Coordinator' }))
  // every active security supervisor (on call first), and staff with the car-supervisor role
  const onCall = await onCallSupervisors()
  const all = s.transportDocs.supervisors.filter((x) => x.active && waNumber(x.phone))
  const supUsers = await User.find({ status: 'ACTIVE', deletedAt: null, $or: [{ role: 'TRANSPORT_SUPERVISOR' }, { roles: 'TRANSPORT_SUPERVISOR' }] }).select('name phone whatsapp').lean<any[]>()
  const security = [
    ...onCall.map((x) => ({ name: x.name, phone: x.phone, role: 'Security supervisor (on call)' })),
    ...all.filter((x) => !onCall.some((o) => waNumber(o.phone) === waNumber(x.phone))).map((x) => ({ name: x.name, phone: x.phone, role: 'Security supervisor' })),
    ...supUsers.filter((u) => waNumber(u.whatsapp || u.phone)).map((u) => ({ id: String(u._id), name: u.name, phone: u.whatsapp || u.phone, role: 'Security supervisor' })),
  ].filter((x, i, arr) => arr.findIndex((y) => waNumber(y.phone) === waNumber(x.phone)) === i)
  return { coordinators, security, hospital: s.general.hospitalPhone || null, emergency: '999' }
}

/** GET /api/v1/requests/:id/help — the numbers the Help button calls / messages (anyone who can open the request). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await loadRequest(params.id, user)
  return contacts(r)
})

const HelpInput = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  accuracyM: z.number().nonnegative().optional(),
  note: z.string().max(300).optional(),
  to: z.array(z.enum(['coordinator', 'security'])).min(1).default(['coordinator', 'security']),
})

/**
 * POST /api/v1/requests/:id/help — a team member needs help now. WhatsApp from the hospital number goes out at once
 * (past quiet hours and the usual limits) to the coordinators and / or the security supervisors on call, with the visit,
 * the patient's address and a map link to where the phone is; the coordinators also get a high-priority alert in the app.
 */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const input = await body(req, HelpInput)
  const c = await contacts(r)
  const me = await User.findById(user.id).select('name phone whatsapp designation role').lean<any>()
  const p = r.patientSnapshot ?? {}
  const map = input.lat != null && input.lng != null ? `https://maps.google.com/?q=${input.lat},${input.lng}` : null
  const text = [
    `🚨 *HELP NEEDED* · Unico Home Care`,
    `${me?.name ?? user.name}${me?.designation ? ` (${me.designation})` : ''} needs help now.`,
    input.note ? `Note: ${input.note}` : null,
    `Visit: ${r.requestNo} · ${[p.name, ageGender(p.ageYears, p.gender)].filter(Boolean).join(', ')}`,
    p.address || p.area ? `Address: ${[p.address, p.area && !String(p.address ?? '').includes(p.area) ? p.area : null].filter(Boolean).join(', ')}` : null,
    map ? `Location now: ${map}${input.accuracyM ? ` (±${Math.round(input.accuracyM)} m)` : ''}` : 'Location: not available from the phone',
    `Time: ${fmtTime(new Date())}`,
    me?.phone ? `Call: ${me.phone}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const people = [...(input.to.includes('coordinator') ? c.coordinators : []), ...(input.to.includes('security') ? c.security : [])]
  const seen = new Set<string>()
  const targets = people.filter((x) => {
    const n = waNumber(x.phone)
    if (!n || seen.has(n) || n === waNumber(me?.whatsapp || me?.phone)) return false
    seen.add(n)
    return true
  })
  const { queueWhatsApp, pumpWhenFree } = await import('@/lib/wa/service')
  const logs = []
  for (const t of targets) logs.push(await queueWhatsApp({ to: t.phone, toName: t.name, text, templateKey: 'HELP', requestId: r._id, patientId: r.patientId, initiatedBy: user.id, priority: 100, approved: true }))
  // first in line, past quiet hours and per-person limits (as "Send now")
  const ids = logs.filter((l) => l.status === 'QUEUED').map((l) => l._id)
  if (ids.length) await MessageLog.updateMany({ _id: { $in: ids } }, { $set: { force: true, priority: 100 } })
  const sent = ids.length ? await pumpWhenFree(25_000).catch(() => ({ sent: 0, failed: 0 })) : { sent: 0, failed: 0 }

  // everyone on the staff sees it in the app at once (no approval, no rules): coordinators, security and all staff
  const everyone = await User.find({ status: 'ACTIVE', deletedAt: null, _id: { $ne: user.id } }).select('_id').lean<any[]>()
  await notifyUsers(everyone.map((u) => u._id), {
    type: 'EMERGENCY',
    title: `🚨 Help needed · ${me?.name ?? user.name}`,
    body: [`${r.requestNo} · ${p.name ?? ''}`, input.note, map ? `Location: ${map}` : null].filter(Boolean).join(' · '),
    requestId: r._id,
    url: `/requests/${r._id}`,
    priority: 'high',
  })
  await audit(user, 'request.help', 'request', r._id, { after: { to: targets.map((t) => t.name), location: map }, label: r.requestNo }, clientMeta(req, user))
  return {
    ok: true,
    to: targets.map((t) => ({ name: t.name, role: t.role })),
    queued: ids.length,
    sent: sent.sent,
    skipped: logs.filter((l) => l.status === 'SKIPPED').map((l) => `${l.toName}: ${l.error}`),
    text,
  }
})
