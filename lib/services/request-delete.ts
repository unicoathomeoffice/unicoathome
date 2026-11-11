import 'server-only'
import { z } from 'zod'
import { HomecareRequest, MessageLog, isOid } from '../models'
import { audit } from '../audit'
import { bad, forbidden } from '../api'
import { can } from '../constants'
import type { SessionUser } from '../auth'

type Meta = { ip?: string; userAgent?: string; client?: string }

// Remove unwanted / duplicate requests. Soft delete: the record stays (deletedAt, who, why) and the audit log keeps the
// trail, but the request disappears from the board, reports, the staff app and the background jobs (models.ts hides
// deletedAt rows from every read). Messages still waiting to go out on WhatsApp are dropped.

/** a team is out on the visit: cancel it first, so staff and the patient are told */
const ON_VISIT = ['EN_ROUTE', 'IN_PROGRESS']

export const DeleteRequestsInput = z.object({
  ids: z.array(z.string()).min(1).max(100),
  reason: z.string().trim().min(3, 'Say why (e.g. duplicate, test entry)'),
})

export async function deleteRequests(input: z.infer<typeof DeleteRequestsInput>, user: SessionUser, meta: Meta = {}) {
  if (!can(user, 'requests.delete')) throw forbidden('You cannot delete requests')
  const ids = [...new Set(input.ids)].filter(isOid)
  const rows = await HomecareRequest.find({ _id: { $in: ids }, deletedAt: null }).select('requestNo status patientSnapshot.name billing.invoiceNo').lean<any[]>()
  if (!rows.length) throw bad('Nothing to delete — the requests are already gone')
  const busy = rows.filter((r) => ON_VISIT.includes(r.status))
  if (busy.length) throw bad(`${busy.map((r) => r.requestNo).join(', ')} ${busy.length === 1 ? 'is' : 'are'} on a visit right now — cancel ${busy.length === 1 ? 'it' : 'them'} first`)
  const now = new Date()
  for (const r of rows) {
    await HomecareRequest.updateOne({ _id: r._id, deletedAt: null }, { $set: { deletedAt: now, deletedBy: user.id, deleteReason: input.reason, 'tracking.active': false } })
    await MessageLog.updateMany({ requestId: r._id, status: { $in: ['QUEUED', 'PENDING'] } }, { $set: { status: 'SKIPPED', error: 'Request deleted' }, $push: { events: { status: 'SKIPPED', at: now, note: 'Request deleted' } } })
    await (await import('./stock')).syncVisitStockQuietly(r._id, user, { giveBack: true }, meta) // consumables go back to the store
    await audit(user, 'request.delete', 'request', r._id, { before: { status: r.status, invoiceNo: r.billing?.invoiceNo }, after: { deleted: true, reason: input.reason }, label: r.requestNo }, meta)
  }
  return { deleted: rows.map((r) => r.requestNo) }
}
