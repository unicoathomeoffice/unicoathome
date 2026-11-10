import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { Attachment, HomecareRequest, User } from '@/lib/models'
import { readBlob } from '@/lib/storage'

/** GET /api/v1/public/track/:token/photo — the travelling staff member's profile photo for the patient's tracking page
 *  (Uber-style driver card). Only while that link's trip is on the way; nothing else about the person is exposed. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!/^[\w-]{12,40}$/.test(token)) return new NextResponse(null, { status: 404 })
  await db()
  const r = await HomecareRequest.findOne({ 'tracking.shareToken': token, 'tracking.active': true, 'tracking.phase': 'OUT', deletedAt: null }).select('tracking.userId').lean<any>()
  const u = r?.tracking?.userId ? await User.findById(r.tracking.userId).select('photoUrl').lean<any>() : null
  const id = String(u?.photoUrl ?? '').split('/').pop()
  if (!id || !/^[a-f0-9]{24}$/i.test(id)) return new NextResponse(null, { status: 404 })
  const a = await Attachment.findOne({ _id: id, kind: 'AVATAR', deletedAt: null }).select('+data +blobUrl mime storage').lean<any>()
  if (!a) return new NextResponse(null, { status: 404 })
  const headers = { 'content-type': a.mime ?? 'image/webp', 'cache-control': 'private, max-age=600' }
  if (a.storage === 'blob' && a.blobUrl) {
    const b = await readBlob(a.blobUrl)
    return b ? new Response(b.stream, { headers }) : new NextResponse(null, { status: 404 })
  }
  if (!a.data) return new NextResponse(null, { status: 404 })
  const buf: Buffer = a.data?.buffer ? Buffer.from(a.data.buffer) : Buffer.from(a.data)
  return new Response(new Uint8Array(buf), { headers })
}
