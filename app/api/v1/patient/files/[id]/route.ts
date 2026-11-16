import { ApiError } from '@/lib/api'
import { isOid } from '@/lib/models'
import { patientRoute } from '@/lib/patient-auth'
import { patientFile } from '@/lib/services/patient-module'
import { readBlob } from '@/lib/storage'

/** GET /api/v1/patient/files/:id — a signed-in patient opens their own report, prescription, visit report or bill. */
export const GET = patientRoute<{ id: string }>(async ({ patient, params }) => {
  if (!isOid(params.id)) throw new ApiError(404, 'NOT_FOUND', 'File not found')
  const a = await patientFile(patient, params.id)
  if (!a) throw new ApiError(404, 'NOT_FOUND', 'File not found')
  const headers = { 'content-type': a.mime, 'content-disposition': `inline; filename="${encodeURIComponent(a.filename ?? 'file')}"`, 'cache-control': 'private, max-age=3600' }
  if (a.storage === 'blob' && a.blobUrl) {
    const b = await readBlob(a.blobUrl)
    if (!b) throw new ApiError(404, 'NOT_FOUND', 'File not found')
    return new Response(b.stream, { headers })
  }
  if (!a.data) throw new ApiError(404, 'NOT_FOUND', 'File not found')
  const buf: Buffer = a.data?.buffer ? Buffer.from(a.data.buffer) : Buffer.from(a.data)
  return new Response(new Uint8Array(buf), { headers })
})
