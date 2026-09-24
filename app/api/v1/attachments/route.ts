import { route, bad, clientMeta } from '@/lib/api'
import { Attachment, Types, isOid } from '@/lib/models'
import { loadRequest } from '@/lib/services/requests'
import { audit } from '@/lib/audit'
import { blobEnabled, blobPath, storeBlob, MAX_UPLOAD_BYTES } from '@/lib/storage'

const KINDS = ['PRESCRIPTION', 'REPORT', 'WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'SIGNATURE', 'VISIT_REPORT', 'PHOTO', 'OTHER']

/**
 * POST /api/v1/attachments (multipart/form-data): file, kind, requestId? | patientId?, caption?
 * Stored in the private Vercel Blob store when configured, otherwise inline in MongoDB.
 * Images are compressed + time-watermarked in the browser first (components/client uploadFile).
 */
export const POST = route(async ({ req, user }) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw bad('No file')
  if (file.size > MAX_UPLOAD_BYTES) throw bad(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  if (!/^(image\/(jpeg|png|webp)|application\/pdf)$/.test(file.type)) throw bad('Only JPG, PNG, WEBP or PDF files')
  const kind = String(form.get('kind') ?? 'OTHER')
  if (!KINDS.includes(kind)) throw bad('Unknown attachment kind')
  const requestId = String(form.get('requestId') ?? '')
  const patientId = String(form.get('patientId') ?? '')
  let r: any = null
  if (requestId) r = await loadRequest(requestId, user)
  const data = Buffer.from(await file.arrayBuffer())
  const _id = new Types.ObjectId()

  let stored: { storage: 'mongo' | 'blob'; blobUrl?: string; data?: Buffer } = { storage: 'mongo', data }
  if (blobEnabled()) {
    const path = blobPath({ requestId: r ? String(r._id) : undefined, patientId: isOid(patientId) ? patientId : undefined, userId: user.id, kind, filename: `${_id}-${file.name}` })
    const b = await storeBlob(path, data, file.type)
    stored = { storage: 'blob', blobUrl: b.url }
  }

  const a = await Attachment.create({
    _id,
    ownerType: r ? 'REQUEST' : patientId ? 'PATIENT' : 'USER',
    ownerId: r?._id ?? (isOid(patientId) ? patientId : user.id),
    requestId: r?._id,
    kind,
    filename: file.name,
    mime: file.type,
    size: file.size,
    ...stored,
    caption: String(form.get('caption') ?? '') || undefined,
    uploadedBy: user.id,
  })
  if (r && ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO'].includes(kind)) {
    r.visit.photoIds.push(a._id)
    await r.save()
  }
  await audit(user, 'attachment.upload', 'attachment', a._id, { after: { kind, filename: file.name, size: file.size, storage: stored.storage, requestNo: r?.requestNo } }, clientMeta(req, user))
  return { id: String(a._id), url: `/api/v1/attachments/${a._id}`, storage: stored.storage }
})
