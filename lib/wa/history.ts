import 'server-only'
import { HomecareRequest, MessageLog, Patient, User } from '../models'
import { ROLE_LABEL } from '../constants'
import { waNumber } from '../messaging'
import { refreshPending } from './outbox'

// The WhatsApp inbox (/outbox): every WhatsApp the app has written, as one chat per phone number — waiting for
// approval, sent, delivered, read, failed or discarded — with the full history of each message (MessageLog.events).

const WA = { channel: 'WHATSAPP' } as const
/** Delivered / read receipts are recorded from this moment on; older sent messages have no delivery report. */
export const RECEIPTS_SINCE = new Date('2026-11-14T05:00:00Z')
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export type ChatFilter = 'all' | 'waiting' | 'sent' | 'failed' | 'discarded'
export type ChatRow = {
  to: string
  name: string
  role: string | null
  last: { text: string; status: string; at: string; file: string | null }
  waiting: number
  failed: number
  total: number
}
export type Contact = { to: string; name: string; role: string | null; href: string | null }

/** The spellings a number may be saved with on staff / patient records. */
function variants(to: string) {
  const ten = to.slice(-10)
  return [to, `+${to}`, `0${ten}`, ten, `+880${ten}`, `880${ten}`, `+880 ${ten}`]
}

/** Who is behind each number: staff (with their role) or a patient. */
async function whoIs(numbers: string[]): Promise<Map<string, Contact>> {
  const out = new Map<string, Contact>()
  if (!numbers.length) return out
  const all = numbers.flatMap(variants)
  const [users, pats] = await Promise.all([
    User.find({ deletedAt: null, $or: [{ phone: { $in: all } }, { whatsapp: { $in: all } }] }).select('name phone whatsapp role designation').lean<any[]>(),
    Patient.find({ $or: [{ phone: { $in: all } }, { whatsapp: { $in: all } }] }).select('name phone whatsapp').limit(500).lean<any[]>(),
  ])
  for (const n of numbers) {
    const u = users.find((x) => waNumber(x.whatsapp) === n || waNumber(x.phone) === n)
    if (u) {
      out.set(n, { to: n, name: u.name, role: u.designation || ROLE_LABEL[u.role as keyof typeof ROLE_LABEL] || 'Staff', href: `/staff?q=${encodeURIComponent(u.name)}` })
      continue
    }
    const p = pats.find((x) => waNumber(x.whatsapp) === n || waNumber(x.phone) === n)
    if (p) out.set(n, { to: n, name: p.name, role: 'Patient', href: `/patients/${p._id}` })
  }
  return out
}

/** Ticks worth collecting: something sent in the last 7 days (after tracking began) is still at a single ✓. */
export async function receiptsDue() {
  const since = new Date(Math.max(Date.now() - 7 * 86400_000, RECEIPTS_SINCE.getTime()))
  return !!(await MessageLog.exists({ ...WA, status: { $in: ['SENT', 'SENT_CONFIRMED', 'DELIVERED'] }, providerId: { $ne: null }, sentAt: { $gte: since } }))
}

/** One row per number, newest first — numbers with messages waiting for approval on top. */
export async function listChats(opts: { q?: string; filter?: ChatFilter; limit?: number } = {}): Promise<ChatRow[]> {
  const match: Record<string, any> = { ...WA, to: { $nin: [null, ''] } }
  const q = opts.q?.trim()
  if (q) {
    const rx = new RegExp(esc(q), 'i')
    const digits = q.replace(/\D/g, '')
    const reqs = await HomecareRequest.find({ $or: [{ requestNo: rx }, { 'patientSnapshot.name': rx }, { 'patientSnapshot.uhid': rx }] }).select('_id').limit(100).lean<any[]>()
    match.$or = [{ toName: rx }, ...(digits.length >= 4 ? [{ to: new RegExp(esc(digits.slice(-10))) }] : []), ...(reqs.length ? [{ requestId: { $in: reqs.map((r) => r._id) } }] : [])]
  }
  const rows = await MessageLog.aggregate([
    { $match: match },
    { $sort: { at: -1 } },
    {
      $group: {
        _id: '$to',
        name: { $first: '$toName' },
        names: { $addToSet: '$toName' },
        text: { $first: '$renderedText' },
        status: { $first: '$status' },
        at: { $first: '$at' },
        file: { $first: '$fileName' },
        total: { $sum: 1 },
        waiting: { $sum: { $cond: [{ $eq: ['$status', 'PENDING'] }, 1, 0] } },
        failed: { $sum: { $cond: [{ $eq: ['$status', 'FAILED'] }, 1, 0] } },
        sent: { $sum: { $cond: [{ $in: ['$status', ['SENT', 'SENT_CONFIRMED', 'DELIVERED', 'OPENED']] }, 1, 0] } },
        skipped: { $sum: { $cond: [{ $eq: ['$status', 'SKIPPED'] }, 1, 0] } },
      },
    },
    { $sort: { at: -1 } },
    { $limit: 600 },
  ])
  const f = opts.filter ?? 'all'
  const kept = rows.filter((r) => (f === 'waiting' ? r.waiting > 0 : f === 'failed' ? r.failed > 0 : f === 'sent' ? r.sent > 0 : f === 'discarded' ? r.skipped > 0 : true))
  const who = await whoIs(kept.map((r) => r._id))
  return kept
    .map((r) => {
      const c = who.get(r._id)
      const named = r.name || r.names.find(Boolean)
      return {
        to: r._id as string,
        name: c?.name ?? named ?? `+${r._id}`,
        role: c?.role ?? null,
        last: { text: String(r.text ?? ''), status: r.status, at: new Date(r.at).toISOString(), file: r.file ?? null },
        waiting: r.waiting,
        failed: r.failed,
        total: r.total,
      }
    })
    .sort((a, b) => (b.waiting > 0 ? 1 : 0) - (a.waiting > 0 ? 1 : 0) || b.last.at.localeCompare(a.last.at))
    .slice(0, opts.limit ?? 300)
}

export type ThreadMsg = {
  id: string
  text: string
  originalText: string | null
  status: string
  at: string
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  /** sent before delivery tracking started: a single ✓ is all there will ever be */
  untracked: boolean
  error: string | null
  file: string | null
  attachmentId: string | null
  templateKey: string | null
  urgent: boolean
  initiatedBy: string | null
  approvedBy: string | null
  editedBy: string | null
  events: { status: string; at: string; note: string | null }[]
  visit: { id: string; label: string; requestNo: string; status: string } | null
}

/** The messages to one number, oldest → newest (50 at a time, `before` = load earlier). */
export async function chatThread(to: string, opts: { before?: string | null; limit?: number } = {}) {
  const n = waNumber(to)
  await refreshPending({ to: n }).catch(() => 0)
  const limit = Math.min(opts.limit ?? 50, 200)
  const before = opts.before ? new Date(opts.before) : null
  const rows = await MessageLog.find({ ...WA, to: n, ...(before && !isNaN(+before) ? { at: { $lt: before } } : {}) })
    .sort({ at: -1 })
    .limit(limit + 1)
    .select('-renderedHtml')
    .lean<any[]>()
  const hasMore = rows.length > limit
  const list = rows.slice(0, limit).reverse()
  const ids = (k: string) => list.map((m) => m[k]).filter(Boolean).map(String)
  const [users, reqs, who] = await Promise.all([
    User.find({ _id: { $in: [...new Set([...ids('initiatedBy'), ...ids('approvedBy'), ...ids('editedBy')])] } }).select('name').lean<any[]>(),
    HomecareRequest.find({ _id: { $in: [...new Set(ids('requestId'))] } }).select('requestNo patientSnapshot.name services.name scheduledAt status').lean<any[]>(),
    whoIs([n]),
  ])
  const name = (id: unknown) => (id ? users.find((u) => String(u._id) === String(id))?.name ?? null : null)
  const fmt = (d?: Date) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '')
  const items: ThreadMsg[] = list.map((m) => {
    const q = reqs.find((x) => String(x._id) === String(m.requestId))
    return {
      id: String(m._id),
      text: m.renderedText ?? '',
      originalText: m.originalText != null && m.originalText !== m.renderedText ? m.originalText : null,
      status: m.status,
      at: new Date(m.at).toISOString(),
      sentAt: m.sentAt ? new Date(m.sentAt).toISOString() : null,
      deliveredAt: m.deliveredAt ? new Date(m.deliveredAt).toISOString() : null,
      readAt: m.readAt ? new Date(m.readAt).toISOString() : null,
      untracked: ['SENT', 'SENT_CONFIRMED'].includes(m.status) && new Date(m.sentAt ?? m.at) < RECEIPTS_SINCE,
      error: m.error ?? null,
      file: m.attachmentId || m.fileName ? m.fileName ?? 'file' : null,
      attachmentId: m.attachmentId ? String(m.attachmentId) : null,
      templateKey: m.templateKey ?? null,
      urgent: (m.priority ?? 0) >= 10,
      initiatedBy: name(m.initiatedBy),
      approvedBy: name(m.approvedBy),
      editedBy: name(m.editedBy),
      events: (m.events ?? []).map((e: any) => ({ status: e.status, at: e.at ? new Date(e.at).toISOString() : new Date(m.at).toISOString(), note: e.note ?? null })),
      visit: q ? { id: String(q._id), label: [q.patientSnapshot?.name, (q.services ?? []).map((s: any) => s.name).join(', '), fmt(q.scheduledAt)].filter(Boolean).join(' · '), requestNo: q.requestNo, status: q.status } : null,
    }
  })
  const latestName = rows.find((m) => m.toName)?.toName ?? (await MessageLog.findOne({ ...WA, to: n, toName: { $nin: [null, ''] } }).sort({ at: -1 }).select('toName').lean<any>())?.toName
  const c = who.get(n)
  const contact: Contact = { to: n, name: c?.name ?? latestName ?? `+${n}`, role: c?.role ?? null, href: c?.href ?? null }
  return { contact, items, hasMore }
}
