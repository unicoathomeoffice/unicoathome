import { z } from 'zod'
import { route, body, bad, qp, clientMeta } from '@/lib/api'
import { Attachment, ChatMessage, User, isOid } from '@/lib/models'
import { loadRequest, isTeamMember } from '@/lib/services/requests'
import { background, notifyRoles, notifyUsers } from '@/lib/messaging'
import { audit } from '@/lib/audit'
import { plain } from '@/lib/db'

function shape(m: any, users: any[], me: string) {
  const u = users.find((x) => String(x._id) === String(m.senderId))
  return {
    id: String(m._id),
    kind: m.kind ?? 'TEXT',
    text: m.text ?? '',
    attachmentId: m.attachmentId ? String(m.attachmentId) : null,
    at: m.createdAt,
    mine: !!m.senderId && String(m.senderId) === me,
    sender: u ? { id: String(u._id), name: u.name, role: u.role } : null,
  }
}

/** GET /api/v1/requests/:id/chat?after=<iso> — the visit thread (oldest first), with sender names. Marks messages read. */
export const GET = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const after = qp(req).get('after')
  const f: Record<string, any> = { requestId: r._id }
  if (after && !isNaN(Date.parse(after))) f.createdAt = { $gt: new Date(after) }
  const rows = await ChatMessage.find(f).sort({ createdAt: 1 }).limit(500).lean<any[]>()
  const users = await User.find({ _id: { $in: [...new Set(rows.map((m) => String(m.senderId ?? '')).filter(isOid))] } })
    .select('name role')
    .lean<any[]>()
  if (rows.length) await ChatMessage.updateMany({ requestId: r._id, readBy: { $ne: user.id } }, { $addToSet: { readBy: user.id } })
  return { items: plain(rows.map((m) => shape(m, users, user.id))) }
})

const Input = z
  .object({ text: z.string().trim().max(2000).optional(), attachmentId: z.string().optional() })
  .refine((x) => !!x.text || !!x.attachmentId, { message: 'Type a message or attach a photo' })

/** POST /api/v1/requests/:id/chat {text?, attachmentId?} — anyone who can view the visit can write. */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  const r = await loadRequest(params.id, user)
  const input = await body(req, Input)
  let attachmentId: string | undefined
  if (input.attachmentId) {
    if (!isOid(input.attachmentId)) throw bad('Invalid attachment')
    const a = await Attachment.findOne({ _id: input.attachmentId, deletedAt: null }).select('requestId uploadedBy').lean<any>()
    if (!a || (a.requestId && String(a.requestId) !== String(r._id))) throw bad('Attachment not found on this visit')
    attachmentId = input.attachmentId
  }
  const m = await ChatMessage.create({ requestId: r._id, senderId: user.id, kind: attachmentId ? 'PHOTO' : 'TEXT', text: input.text || undefined, attachmentId, readBy: [user.id] })
  await audit(user, 'chat.send', 'request', r._id, { after: { kind: m.kind, text: input.text?.slice(0, 140), attachmentId }, label: r.requestNo }, clientMeta(req, user))
  const preview = input.text ? input.text.slice(0, 120) : 'Sent a photo'
  const team = [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].filter(Boolean).map(String)
  background(async () => {
    if (isTeamMember(user, r)) {
      // staff wrote → coordinators; the rest of the team sees it in the thread
      await notifyRoles(['HC_ADMIN'], { type: 'CHAT', title: `${user.name} · ${r.requestNo}`, body: preview, requestId: r._id, url: `/requests/${r._id}?tab=chat` }, user.id)
      await notifyUsers(team.filter((x) => x !== user.id), { type: 'CHAT', title: `${user.name} · ${r.requestNo}`, body: preview, requestId: r._id, url: `/m/visits/${r._id}/chat` })
    } else {
      await notifyUsers(team.filter((x) => x !== user.id), { type: 'CHAT', title: `${user.name} · ${r.requestNo}`, body: preview, requestId: r._id, url: `/m/visits/${r._id}/chat` })
    }
  })
  const u = await User.findById(user.id).select('name role').lean<any>()
  return { item: plain(shape(m.toObject(), [u], user.id)) }
})
