import 'server-only'
import { Attachment, Types } from './models'
import { blobEnabled, blobPath, readBlob, storeBlob } from './storage'

// Server-side file helpers shared by uploads, generated documents (invoices, requisitions, gate passes, claim forms)
// and WhatsApp document sending. Files live in the private Blob store when configured, else inline in MongoDB.

export const ATTACHMENT_KINDS = [
  'PRESCRIPTION',
  'REPORT',
  'WOUND_PHOTO',
  'DRESSING_PHOTO',
  'SAMPLE_LABEL',
  'SIGNATURE',
  'VISIT_REPORT',
  'PHOTO',
  'INVOICE',
  'REQUISITION',
  'GATE_PASS',
  'CLAIM',
  'RECEIPT',
  'OTHER',
] as const
export type AttachmentKind = (typeof ATTACHMENT_KINDS)[number]

/** Store bytes as an Attachment (Blob or inline). Returns the new document (lean-ish). */
export async function storeFile(o: {
  data: Buffer
  mime: string
  filename: string
  kind: AttachmentKind
  uploadedBy?: string
  requestId?: unknown
  ownerType?: 'REQUEST' | 'PATIENT' | 'USER' | 'CHAT'
  ownerId?: unknown
  caption?: string
}) {
  const _id = new Types.ObjectId()
  let stored: { storage: 'mongo' | 'blob'; blobUrl?: string; data?: Buffer } = { storage: 'mongo', data: o.data }
  if (blobEnabled()) {
    const path = blobPath({ requestId: o.requestId ? String(o.requestId) : undefined, userId: String(o.uploadedBy ?? 'system'), kind: o.kind, filename: `${_id}-${o.filename}` })
    const b = await storeBlob(path, o.data, o.mime)
    stored = { storage: 'blob', blobUrl: b.url }
  }
  return Attachment.create({
    _id,
    ownerType: o.ownerType ?? (o.requestId ? 'REQUEST' : 'USER'),
    ownerId: o.ownerId ?? o.requestId ?? o.uploadedBy,
    requestId: o.requestId,
    kind: o.kind,
    filename: o.filename,
    mime: o.mime,
    size: o.data.length,
    ...stored,
    caption: o.caption,
    uploadedBy: o.uploadedBy,
  })
}

/** Bytes of an Attachment, or null when it is gone. */
export async function readFile(id: unknown): Promise<{ data: Buffer; mime: string; filename: string } | null> {
  const a = await Attachment.findOne({ _id: id, deletedAt: null }).select('+data +blobUrl mime filename storage').lean<any>()
  if (!a) return null
  if (a.storage === 'blob' && a.blobUrl) {
    const b = await readBlob(a.blobUrl)
    if (!b) return null
    const chunks: Uint8Array[] = []
    const reader = (b.stream as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }
    return { data: Buffer.concat(chunks), mime: a.mime, filename: a.filename ?? 'file' }
  }
  if (!a.data) return null
  return { data: a.data?.buffer ? Buffer.from(a.data.buffer) : Buffer.from(a.data), mime: a.mime, filename: a.filename ?? 'file' }
}
