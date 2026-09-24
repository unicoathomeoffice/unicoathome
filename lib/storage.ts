import 'server-only'
import { put, get, del } from '@vercel/blob'

/**
 * File storage for attachments (photos, signatures, prescriptions, reports).
 * - Vercel Blob (private store) when configured: BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID + Vercel OIDC on deployments.
 * - Otherwise files are kept inline in MongoDB (small deployments / local dev).
 * Private blobs are never exposed directly: /api/v1/attachments/:id checks access and streams them.
 */
export const blobEnabled = () => !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID)

/** Largest upload we accept. Vercel functions accept ~4.5 MB request bodies; images are compressed in the browser first. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

export async function storeBlob(pathname: string, data: Buffer, contentType: string) {
  const res = await put(pathname, data, { access: 'private', contentType, addRandomSuffix: true })
  return { url: res.url, pathname: res.pathname }
}

export async function readBlob(url: string) {
  const res = await get(url, { access: 'private' })
  if (!res || res.statusCode !== 200 || !res.stream) return null
  return { stream: res.stream, contentType: res.blob.contentType, size: res.blob.size }
}

export async function deleteBlob(url: string) {
  try {
    await del(url)
  } catch (e) {
    console.error('[storage] delete failed', url, e)
  }
}

/** Storage path: requests/<requestId>/<kind>/<name> keeps a record's files together in the Blob browser. */
export function blobPath(opts: { requestId?: string; patientId?: string; userId: string; kind: string; filename: string }) {
  const safe = opts.filename.replace(/[^\w.\-]+/g, '_').slice(-80) || 'file'
  const owner = opts.requestId ? `requests/${opts.requestId}` : opts.patientId ? `patients/${opts.patientId}` : `users/${opts.userId}`
  return `${owner}/${opts.kind.toLowerCase()}/${safe}`
}
