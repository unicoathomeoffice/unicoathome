import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Attachment, isOid } from '@/lib/models'
import { getUser } from '@/lib/auth'
import { getPatient } from '@/lib/patient-auth'
import { readBlob } from '@/lib/storage'

/**
 * GET /api/v1/avatars/:id — a profile photo. Any signed-in staff member or patient may see it (patients see their
 * care team). Only AVATAR attachments are served here; the id changes with every new photo, so it caches for a year.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isOid(id)) return new NextResponse(null, { status: 404 })
  await db()
  if (!(await getUser()) && !(await getPatient())) return new NextResponse(null, { status: 401 })
  const a = await Attachment.findOne({ _id: id, kind: 'AVATAR', deletedAt: null }).select('+data +blobUrl mime storage').lean<any>()
  if (!a) return new NextResponse(null, { status: 404 })
  const headers = { 'content-type': a.mime ?? 'image/webp', 'cache-control': 'private, max-age=31536000, immutable' }
  if (a.storage === 'blob' && a.blobUrl) {
    const b = await readBlob(a.blobUrl)
    if (!b) return new NextResponse(null, { status: 404 })
    return new Response(b.stream, { headers })
  }
  if (!a.data) return new NextResponse(null, { status: 404 })
  const buf: Buffer = a.data?.buffer ? Buffer.from(a.data.buffer) : Buffer.from(a.data)
  return new Response(new Uint8Array(buf), { headers })
}
