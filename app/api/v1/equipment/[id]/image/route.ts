import { NextResponse, type NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { route, bad, notFound, clientMeta } from '@/lib/api'
import { Attachment, Equipment, isOid } from '@/lib/models'
import { getUser } from '@/lib/auth'
import { storeFile } from '@/lib/files'
import { readBlob, MAX_UPLOAD_BYTES } from '@/lib/storage'
import { audit } from '@/lib/audit'
import { forgetMaster } from '@/lib/cached'
import sharp from 'sharp'
import { can } from '@/lib/constants'
import { forbidden } from '@/lib/api'
import { galleryOf, materialize, MAX_IMAGES, retireIfUnused } from '@/lib/services/item-images'

/** GET /api/v1/equipment/:id/image[?att=<id>] — the item's cover (or one of its gallery pictures), for any signed-in staff. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!isOid(id)) return new NextResponse(null, { status: 404 })
  await db()
  if (!(await getUser())) return new NextResponse(null, { status: 401 })
  const item = await Equipment.findById(id).select('imageId images').lean<any>()
  const att = req.nextUrl.searchParams.get('att')
  const want = att && isOid(att) ? (galleryOf(item ?? {}).some((g) => g.attachmentId === att) ? att : null) : item?.imageId
  if (!want) return new NextResponse(null, { status: 404 })
  const a = await Attachment.findOne({ _id: want, kind: 'EQUIPMENT', deletedAt: null }).select('+data +blobUrl mime storage').lean<any>()
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

/**
 * POST /api/v1/equipment/:id/image (multipart: file) — catalog or store admins.
 *   default: replace the cover · ?add=1: add to the gallery (cover too when the item has none, or with &cover=1)
 *   ?replace=<attId>: replace one gallery picture (an edited version)
 */
export const POST = route<{ id: string }>(
  async ({ req, user, params }) => {
    if (!can(user, 'master.manage') && !can(user, 'store.manage')) throw forbidden()
    if (!isOid(params.id)) throw notFound('Item')
    const item = await Equipment.findById(params.id)
    if (!item) throw notFound('Item')
    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) throw bad('No file')
    if (file.size > MAX_UPLOAD_BYTES) throw bad(`Picture is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`)
    if (!/^image\/(jpeg|png|webp|avif|heic|heif)$/.test(file.type)) throw bad('Only JPG, PNG, WEBP, AVIF or HEIC pictures')
    const q = req.nextUrl.searchParams
    const add = q.get('add') === '1'
    const replace = q.get('replace')
    materialize(item)
    if (add && item.images.length >= MAX_IMAGES) throw bad(`An item can have up to ${MAX_IMAGES} pictures — remove one first`)
    const pic = await toAvif(Buffer.from(await file.arrayBuffer()))
    const a = await storeFile({ data: pic.data, mime: pic.mime, filename: `${item.name.replace(/[^\w.-]+/g, '-').slice(0, 60)}.${pic.ext}`, kind: 'EQUIPMENT', uploadedBy: user.id, ownerType: 'USER', ownerId: user.id, caption: item.name })
    const caption = String(form.get('caption') ?? '').slice(0, 40) || undefined
    let old: unknown = null
    if (replace && isOid(replace)) {
      // an edited version of one gallery picture: same place, same caption
      const i = item.images.findIndex((x: any) => String(x.attachmentId) === replace)
      if (i < 0) throw notFound('Picture')
      old = item.images[i].attachmentId
      item.images[i].attachmentId = a._id
      if (String(item.imageId) === replace) item.imageId = a._id
    } else if (add) {
      item.images.push({ attachmentId: a._id, caption, at: new Date() })
      if (!item.imageId || q.get('cover') === '1') item.imageId = a._id
    } else {
      // replace the cover
      old = item.imageId
      const i = item.images.findIndex((x: any) => String(x.attachmentId) === String(old))
      if (i >= 0) item.images[i].attachmentId = a._id
      else item.images.unshift({ attachmentId: a._id, caption, at: new Date() })
      item.imageId = a._id
    }
    item.markModified('images')
    await item.save()
    // sizes of a family can share one picture: only retire the old file when nothing uses it any more
    await retireIfUnused(old)
    forgetMaster()
    await audit(user, add ? 'equipment.image_add' : 'equipment.image', 'equipment', item._id, { after: { imageId: String(a._id), cover: String(item.imageId) === String(a._id), pictures: item.images.length }, label: item.name }, clientMeta(req, user))
    return { ok: true, imageId: String(a._id), cover: String(item.imageId), count: item.images.length }
  },
)

/** DELETE — remove the item's picture (the file is retired when no other size of the family still uses it). */
export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'master.manage') && !can(user, 'store.manage')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Item')
  const item = await Equipment.findById(params.id)
  if (!item) throw notFound('Item')
  const old = item.imageId
  if (!old) return { ok: true }
  // remove the cover; the next gallery picture becomes the cover
  materialize(item)
  item.images = item.images.filter((x: any) => String(x.attachmentId) !== String(old))
  item.imageId = item.images[0]?.attachmentId
  item.markModified('images')
  await item.save()
  await retireIfUnused(old)
  forgetMaster()
  await audit(user, 'equipment.image_remove', 'equipment', item._id, { label: item.name }, clientMeta(req, user))
  return { ok: true }
})

/**
 * Store pictures as small, sharp AVIF: turned upright (EXIF), flattened on white, the empty white margin trimmed,
 * fitted inside 1000 px. Falls back to WebP if AVIF encoding fails on this machine.
 */
async function toAvif(input: Buffer): Promise<{ data: Buffer; mime: string; ext: string }> {
  let img = sharp(input, { failOn: 'none' }).rotate().flatten({ background: '#ffffff' })
  try {
    // trim only plain white-ish borders; a photo with no such margin is left as it is
    const trimmed = await img.clone().trim({ background: '#ffffff', threshold: 14 }).png().toBuffer({ resolveWithObject: true })
    if (trimmed.info.width > 40 && trimmed.info.height > 40) img = sharp(trimmed.data)
  } catch {}
  const fit = img.resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
  try {
    return { data: await fit.clone().avif({ quality: 55, effort: 4 }).toBuffer(), mime: 'image/avif', ext: 'avif' }
  } catch {
    return { data: await fit.clone().webp({ quality: 82 }).toBuffer(), mime: 'image/webp', ext: 'webp' }
  }
}
