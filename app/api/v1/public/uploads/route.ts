import { randomBytes } from 'node:crypto'
import sharp from 'sharp'
import { publicRoute, bad, clientMeta, ApiError } from '@/lib/api'
import { Attachment, Types } from '@/lib/models'
import { getPatient } from '@/lib/patient-auth'
import { blobEnabled, storeBlob, MAX_UPLOAD_BYTES } from '@/lib/storage'

export const maxDuration = 60 // AVIF encoding of a phone photo can take a few seconds

// 20 uploads per IP per hour
const hits = new Map<string, number[]>()

/**
 * POST /api/v1/public/uploads (multipart: file) — prescription / document from the public booking form.
 * Images are re-encoded to AVIF (max 1800 px, ~5–10× smaller) and stored in the private Blob store;
 * PDFs are stored as-is. Returns {id, token}: the token proves ownership when the request is submitted,
 * which links the file to the request. Unlinked uploads are deleted by the nightly sweep.
 */
export const POST = publicRoute(async ({ req }) => {
  const { ip } = clientMeta(req)
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 3600_000)
  if (recent.length >= 20) throw new ApiError(429, 'RATE_LIMITED', 'Too many uploads. Please try again later.')
  hits.set(ip, [...recent, now])

  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw bad('No file')
  if (file.size > MAX_UPLOAD_BYTES) throw bad(`File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
  const isPdf = file.type === 'application/pdf'
  if (!isPdf && !/^image\/(jpeg|png|webp|avif|heic|heif)$/.test(file.type)) throw bad('Only photos (JPG, PNG, WEBP) or PDF files')

  let data = Buffer.from(await file.arrayBuffer())
  let mime = file.type
  let filename = file.name || (isPdf ? 'document.pdf' : 'photo')
  if (!isPdf) {
    try {
      data = await sharp(data, { failOn: 'none' }).rotate().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).avif({ quality: 48, effort: 4 }).toBuffer()
      mime = 'image/avif'
      filename = filename.replace(/\.[a-z0-9]+$/i, '') + '.avif'
    } catch {
      throw bad('This image could not be read. Please try another photo.')
    }
  }

  const _id = new Types.ObjectId()
  const token = randomBytes(18).toString('base64url')
  const patient = await getPatient().catch(() => null)
  let stored: { storage: 'mongo' | 'blob'; blobUrl?: string; data?: Buffer } = { storage: 'mongo', data }
  if (blobEnabled()) {
    const b = await storeBlob(`public-uploads/${new Date().toISOString().slice(0, 10)}/${_id}-${filename.replace(/[^\w.\-]+/g, '_').slice(-60)}`, data, mime)
    stored = { storage: 'blob', blobUrl: b.url }
  }
  await Attachment.create({
    _id,
    ownerType: patient ? 'PATIENT' : 'REQUEST',
    ownerId: patient ? patient.id : undefined,
    kind: 'PRESCRIPTION',
    filename,
    mime,
    size: data.length,
    ...stored,
    caption: 'Uploaded by the patient with the booking',
    pending: { token, ip, at: new Date() },
  })
  return { id: String(_id), token, size: data.length, mime }
})
