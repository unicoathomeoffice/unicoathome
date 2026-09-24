import { route, notFound, forbidden, clientMeta } from '@/lib/api'
import { Attachment, HomecareRequest, isOid } from '@/lib/models'
import { canView } from '@/lib/services/requests'
import { audit } from '@/lib/audit'

/** GET /api/v1/attachments/:id — streams the file (access follows the owning request). */
export const GET = route<{ id: string }>(async ({ user, params }) => {
  if (!isOid(params.id)) throw notFound('File')
  const a = await Attachment.findOne({ _id: params.id, deletedAt: null }).select('+data').lean<any>()
  if (!a) throw notFound('File')
  if (a.requestId) {
    const r = await HomecareRequest.findById(a.requestId).select('assignment createdBy transport').lean()
    if (r && !canView(user, r)) throw forbidden()
  }
  const buf: Buffer = a.data?.buffer ? Buffer.from(a.data.buffer) : Buffer.from(a.data)
  return new Response(new Uint8Array(buf), {
    headers: { 'content-type': a.mime, 'content-disposition': `inline; filename="${encodeURIComponent(a.filename ?? 'file')}"`, 'cache-control': 'private, max-age=3600' },
  })
})

export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  if (!isOid(params.id)) throw notFound('File')
  const a = await Attachment.findById(params.id)
  if (!a) throw notFound('File')
  if (String(a.uploadedBy) !== user.id && !['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role)) throw forbidden()
  a.deletedAt = new Date()
  await a.save()
  if (a.requestId) await HomecareRequest.updateOne({ _id: a.requestId }, { $pull: { 'visit.photoIds': a._id } })
  await audit(user, 'attachment.delete', 'attachment', a._id, { before: { kind: a.kind, filename: a.filename } }, clientMeta(req, user))
  return { ok: true }
})
