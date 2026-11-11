import { route, forbidden, notFound, clientMeta } from '@/lib/api'
import { Equipment, isOid } from '@/lib/models'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { forgetMaster } from '@/lib/cached'
import { galleryOf, materialize, retireIfUnused } from '@/lib/services/item-images'

/** DELETE — remove one picture; when it was the cover, the next picture becomes the cover. */
export const DELETE = route<{ id: string; attId: string }>(async ({ req, user, params }) => {
  if (!can(user, 'master.manage') && !can(user, 'store.manage')) throw forbidden()
  if (!isOid(params.id) || !isOid(params.attId)) throw notFound('Picture')
  const item = await Equipment.findById(params.id)
  if (!item) throw notFound('Item')
  materialize(item)
  const before = item.images.length
  item.images = item.images.filter((x: any) => String(x.attachmentId) !== params.attId)
  if (item.images.length === before) throw notFound('Picture')
  if (String(item.imageId) === params.attId) item.imageId = item.images[0]?.attachmentId
  item.markModified('images')
  await item.save()
  await retireIfUnused(params.attId) // shared family pictures stay while another item uses them
  forgetMaster()
  await audit(user, 'equipment.image_remove', 'equipment', item._id, { after: { attachmentId: params.attId, left: item.images.length }, label: item.name }, clientMeta(req, user))
  return { ok: true, items: galleryOf(item) }
})
