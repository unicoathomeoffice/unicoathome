import 'server-only'
import { HomecareRequest, MessageLog, WaAuth } from '../models'
import { audit, type Meta } from '../audit'
import type { SessionUser } from '../auth'
import { background, notifyRoles, stripRequestNo } from '../messaging'

// The WhatsApp Outbox: every WhatsApp waits here as PENDING until an admin previews it, edits it if needed and sends it
// (or discards it). Sending = QUEUED, then the normal sender (lib/wa/service.ts pumpWhatsApp) delivers it safely.

const PROVIDER = 'wa_baileys'
const PENDING = { channel: 'WHATSAPP', provider: PROVIDER, status: 'PENDING' } as const
/** not approved in this time → discarded by the sweep, so the Outbox never fills up with stale news */
export const PENDING_MAX_H = 48

export const pendingCount = () => MessageLog.countDocuments(PENDING)

export type OutboxItem = {
  id: string
  to: string
  toName: string | null
  templateKey: string | null
  text: string
  edited: boolean
  file: string | null
  attachmentId: string | null
  requestId: string | null
  visit: string | null // "Saima Sonom · Sample collection · 2 Nov 9:00 AM" (no HC number — what the message is about)
  requestNo: string | null // for the link on our own screen only
  batch: string | null
  at: string
  urgent: boolean
}

export async function listPending(filter: { batch?: string | null; requestId?: string | null } = {}, limit = 300): Promise<OutboxItem[]> {
  const rows = await MessageLog.find({ ...PENDING, ...(filter.batch ? { batch: filter.batch } : {}), ...(filter.requestId ? { requestId: filter.requestId } : {}) })
    .sort({ at: -1 })
    .limit(limit)
    .select('to toName templateKey renderedText originalText fileName attachmentId requestId batch at priority')
    .lean<any[]>()
  const reqs = await HomecareRequest.find({ _id: { $in: [...new Set(rows.map((r) => String(r.requestId ?? '')).filter(Boolean))] } })
    .select('requestNo patientSnapshot.name services.name scheduledAt')
    .lean<any[]>()
  const fmt = (d?: Date) => (d ? new Date(d).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '')
  return rows.map((r) => {
    const q = reqs.find((x) => String(x._id) === String(r.requestId))
    return {
      id: String(r._id),
      to: r.to,
      toName: r.toName ?? null,
      templateKey: r.templateKey ?? null,
      text: r.renderedText ?? '',
      edited: r.originalText != null && r.originalText !== r.renderedText,
      file: r.attachmentId ? r.fileName ?? 'file' : null,
      attachmentId: r.attachmentId ? String(r.attachmentId) : null,
      requestId: r.requestId ? String(r.requestId) : null,
      visit: q ? [q.patientSnapshot?.name, (q.services ?? []).map((s: any) => s.name).join(', '), fmt(q.scheduledAt)].filter(Boolean).join(' · ') : null,
      requestNo: q?.requestNo ?? null,
      batch: r.batch ?? null,
      at: new Date(r.at).toISOString(),
      urgent: (r.priority ?? 0) >= 10,
    }
  })
}

const cleanText = (t: string) => stripRequestNo(t).slice(0, 1500)

/** Change the text of a waiting message (the generated text is kept in originalText). */
export async function editPending(id: string, text: string, user: SessionUser, meta: Meta = {}) {
  const m = await MessageLog.findOne({ _id: id, ...PENDING })
  if (!m) return null
  const next = cleanText(text)
  if (next === m.renderedText) return m
  if (m.originalText == null) m.originalText = m.renderedText
  m.renderedText = next
  m.editedBy = user.id
  m.events.push({ status: 'PENDING', at: new Date(), note: `Edited by ${user.name}` })
  await m.save()
  await audit(user, 'message.edit', 'message', m._id, { before: { text: m.originalText }, after: { text: next }, label: m.toName ?? m.to }, meta)
  return m
}

type Ids = string[] | 'ALL'
const idFilter = (ids: Ids, batch?: string | null) => ({ ...PENDING, ...(ids === 'ALL' ? (batch ? { batch } : {}) : { _id: { $in: ids } }) })

/** Send: edits applied, then QUEUED for the normal sender. `at` restarts so "too late" counts from the approval. */
export async function approve(ids: Ids, user: SessionUser, opts: { edits?: Record<string, string>; batch?: string | null } = {}, meta: Meta = {}) {
  for (const [id, text] of Object.entries(opts.edits ?? {})) await editPending(id, text, user, meta)
  const rows = await MessageLog.find(idFilter(ids, opts.batch)).select('_id toName to').lean<any[]>()
  if (!rows.length) return 0
  const now = new Date()
  await MessageLog.updateMany(
    { _id: { $in: rows.map((r) => r._id) }, status: 'PENDING' },
    { $set: { status: 'QUEUED', approvedBy: user.id, approvedAt: now, at: now }, $push: { events: { status: 'QUEUED', at: now, note: `Approved by ${user.name}` } } },
  )
  await audit(user, 'message.approve', 'message', rows.length === 1 ? rows[0]._id : null, { after: { count: rows.length, to: rows.slice(0, 20).map((r) => r.toName ?? r.to) } }, meta)
  const { pumpWhatsApp } = await import('./service')
  background(() => pumpWhatsApp())
  return rows.length
}

export async function discard(ids: Ids, user: SessionUser | null, opts: { batch?: string | null; note?: string } = {}, meta: Meta = {}) {
  const rows = await MessageLog.find(idFilter(ids, opts.batch)).select('_id toName to').lean<any[]>()
  if (!rows.length) return 0
  const note = opts.note ?? `Discarded by ${user?.name ?? 'System'}`
  await MessageLog.updateMany({ _id: { $in: rows.map((r) => r._id) }, status: 'PENDING' }, { $set: { status: 'SKIPPED', error: note }, $push: { events: { status: 'SKIPPED', at: new Date(), note } } })
  await audit(user, 'message.discard', 'message', rows.length === 1 ? rows[0]._id : null, { after: { count: rows.length, to: rows.slice(0, 20).map((r) => r.toName ?? r.to), note } }, meta)
  return rows.length
}

/** Sweep: waiting too long → discarded (an "on the way" message two days later only confuses people). */
export async function expirePending() {
  const old = await MessageLog.find({ ...PENDING, at: { $lt: new Date(Date.now() - PENDING_MAX_H * 3600_000) } }).select('_id').lean<any[]>()
  if (!old.length) return 0
  return discard(
    old.map((r) => String(r._id)),
    null,
    { note: `Not approved within ${PENDING_MAX_H} h` },
  )
}

/** At most one in-app alert per 10 minutes: "N WhatsApp messages waiting for approval". */
export async function noticePending() {
  const since = new Date(Date.now() - 10 * 60_000)
  const claimed = await WaAuth.updateOne({ _id: 'meta', $or: [{ outboxNoticeAt: { $exists: false } }, { outboxNoticeAt: { $lt: since } }] }, { $set: { outboxNoticeAt: new Date() } })
  if (!claimed.modifiedCount) return
  const n = await pendingCount()
  if (!n) return
  await notifyRoles(['HC_ADMIN', 'SUPER_ADMIN'], { type: 'APPROVAL', event: 'WA_OUTBOX', title: `${n} WhatsApp message${n === 1 ? '' : 's'} waiting for approval`, body: 'Open the Outbox to preview, edit and send', url: '/outbox' })
}
