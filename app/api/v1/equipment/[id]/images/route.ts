import { z } from 'zod'
import { route, body, bad, forbidden, notFound, clientMeta } from '@/lib/api'
import { Equipment, isOid } from '@/lib/models'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { forgetMaster } from '@/lib/cached'
import { galleryOf, materialize } from '@/lib/services/item-images'

/** GET — the item's pictures (cover first in its place), any signed-in staff. */
export const GET = route<{ id: string }>(async ({ params }) => {
  if (!isOid(params.id)) throw notFound('Item')
  const item = await Equipment.findById(params.id).select('imageId images').lean<any>()
  if (!item) throw notFound('Item')
  return { items: galleryOf(item) }
})

const Patch = z.object({
  cover: z.string().regex(/^[a-f0-9]{24}$/i).optional(),
  order: z.array(z.string().regex(/^[a-f0-9]{24}$/i)).max(20).optional(),
  captions: z.record(z.string(), z.string().trim().max(40)).optional(),
})

/** PATCH { cover?, order?, captions? } — choose the cover, reorder, name pictures (Front / Back / Label / Box…). */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'master.manage') && !can(user, 'store.manage')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Item')
  const input = await body(req, Patch)
  const item = await Equipment.findById(params.id)
  if (!item) throw notFound('Item')
  materialize(item)
  const has = (id: string) => item.images.some((x: any) => String(x.attachmentId) === id)
  if (input.cover) {
    if (!has(input.cover)) throw bad('That picture is not on this item')
    item.imageId = input.cover
  }
  if (input.order) {
    const pos = new Map(input.order.map((id, i) => [id, i]))
    item.images.sort((a: any, b: any) => (pos.get(String(a.attachmentId)) ?? 99) - (pos.get(String(b.attachmentId)) ?? 99))
  }
  for (const [id, cap] of Object.entries(input.captions ?? {})) {
    const x = item.images.find((i: any) => String(i.attachmentId) === id)
    if (x) x.caption = cap || undefined
  }
  item.markModified('images')
  await item.save()
  forgetMaster()
  await audit(user, 'equipment.images', 'equipment', item._id, { after: input, label: item.name }, clientMeta(req, user))
  return { ok: true, items: galleryOf(item) }
})
