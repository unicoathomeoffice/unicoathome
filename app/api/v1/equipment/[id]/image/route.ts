import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, bad, notFound, clientMeta } from '@/lib/api'
import { Attachment, Equipment, isOid } from '@/lib/models'
import { getUser } from '@/lib/auth'
import { storeFile } from '@/lib/files'
import { readBlob, MAX_UPLOAD_BYTES } from '@/lib/storage'
import { audit } from '@/lib/audit'
import { forgetMaster } from '@/lib/cached'

/** GET /api/v1/equipment/:id/image — the item's picture, for any signed-in staff (bag check, service editor, reports). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isOid(id)) return new NextResponse(null, { status: 404 })
  await db()
  if (!(await getUser())) return new NextResponse(null, { status: 401 })
  const item = await Equipment.findById(id).select('imageId').lean<any>()
  if (!item?.imageId) return new NextResponse(null, { status: 404 })
  const a = await Attachment.findOne({ _id: item.imageId, kind: 'EQUIPMENT', deletedAt: null }).select('+data +blobUrl mime storage').lean<any>()
  if (!a) return new NextResponse(null, { status: 404 })
  // the URL carries ?v=<imageId>, so a new picture is a new URL: cache for long
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

/** POST /api/v1/equipment/:id/image (multipart: file) — set or replace the picture (admins). */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!isOid(params.id)) throw notFound('Item')
    const item = await Equipment.findById(params.id)
    if (!item) throw notFound('Item')
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw bad('No file')
    if (file.size > MAX_UPLOAD_BYTES) throw bad(`Picture is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw bad('Only JPG, PNG or WEBP pictures')
    const a = await storeFile({ data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: file.name || 'item.webp', kind: 'EQUIPMENT', uploadedBy: user.id, ownerType: 'USER', ownerId: user.id, caption: item.name })
    const old = item.imageId
    item.imageId = a._id
    await item.save()
    if (old) await Attachment.updateOne({ _id: old }, { deletedAt: new Date() })
    forgetMaster()
    await audit(user, 'equipment.image', 'equipment', item._id, { after: { imageId: String(a._id) }, label: item.name }, clientMeta(req, user))
    return { ok: true, imageId: String(a._id) }
  },
  { perm: 'master.manage' },
)
