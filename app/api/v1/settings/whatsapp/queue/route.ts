import { z } from 'zod'
import { route, body, forbidden, clientMeta } from '@/lib/api'
import { canOpenSettings } from '@/lib/constants'
import { MessageLog, HomecareRequest } from '@/lib/models'
import { audit } from '@/lib/audit'

const PROVIDER = 'wa_baileys'

/** GET ?status=QUEUED|FAILED — WhatsApp messages waiting to go out (or failed in the last 7 days). */
export const GET = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const status = req.nextUrl.searchParams.get('status') === 'FAILED' ? 'FAILED' : 'QUEUED'
  const rows = await MessageLog.find({ channel: 'WHATSAPP', provider: PROVIDER, status, ...(status === 'FAILED' ? { at: { $gte: new Date(Date.now() - 7 * 86400_000) } } : {}) })
    .sort(status === 'QUEUED' ? { priority: -1, at: 1 } : { at: -1 })
    .limit(200)
    .select('to toName templateKey renderedText fileName attachmentId requestId at priority attempts error')
    .lean<any[]>()
  const reqs = await HomecareRequest.find({ _id: { $in: rows.map((r) => r.requestId).filter(Boolean) } }).select('requestNo').lean<any[]>()
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      to: r.to,
      toName: r.toName ?? null,
      templateKey: r.templateKey ?? null,
      text: String(r.renderedText ?? '').slice(0, 220),
      file: r.attachmentId ? r.fileName ?? 'file' : null,
      requestId: r.requestId ? String(r.requestId) : null,
      requestNo: reqs.find((x) => String(x._id) === String(r.requestId))?.requestNo ?? null,
      at: r.at,
      urgent: (r.priority ?? 0) >= 10,
      attempts: r.attempts ?? 0,
      error: r.error ?? null,
    })),
  }
})

const Action = z.object({ action: z.enum(['cancel', 'retry']), ids: z.union([z.array(z.string()).min(1).max(500), z.literal('ALL')]) })

/** POST { action: 'cancel', ids | 'ALL' } — stop queued messages · { action: 'retry', ids } — queue failed ones again. */
export const POST = route(async ({ req, user }) => {
  if (!canOpenSettings(user)) throw forbidden()
  const input = await body(req, Action)
  const from = input.action === 'cancel' ? 'QUEUED' : 'FAILED'
  const f: any = { channel: 'WHATSAPP', provider: PROVIDER, status: from, ...(input.ids === 'ALL' ? {} : { _id: { $in: input.ids } }) }
  const note = input.action === 'cancel' ? `Cancelled by ${user.name}` : `Queued again by ${user.name}`
  const res = await MessageLog.updateMany(f, {
    $set: input.action === 'cancel' ? { status: 'SKIPPED', error: note } : { status: 'QUEUED', attempts: 0, error: null, at: new Date() },
    $push: { events: { status: input.action === 'cancel' ? 'SKIPPED' : 'QUEUED', at: new Date(), note } },
  })
  await audit(user, input.action === 'cancel' ? 'message.whatsapp_cancel' : 'message.whatsapp_retry', 'settings', 'whatsapp', { after: { count: res.modifiedCount, ids: input.ids === 'ALL' ? 'ALL' : input.ids.length } }, clientMeta(req, user))
  if (input.action === 'retry' && res.modifiedCount) {
    const { background } = await import('@/lib/messaging')
    const { pumpWhatsApp } = await import('@/lib/wa/service')
    background(() => pumpWhatsApp())
  }
  return { ok: true, count: res.modifiedCount }
})
