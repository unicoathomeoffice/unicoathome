import { z } from 'zod'
import { route, body, bad, forbidden, notFound, clientMeta } from '@/lib/api'
import { Equipment, isOid } from '@/lib/models'
import { can } from '@/lib/constants'
import { audit } from '@/lib/audit'
import { forgetMaster } from '@/lib/cached'

/** POST { all? } — use this item's picture for the other sizes of its family (only those without one, or all). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'master.manage') && !can(user, 'store.manage')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Item')
  const { all } = await body(req, z.object({ all: z.boolean().optional() }))
  const item = await Equipment.findById(params.id).select('name family imageId').lean<any>()
  if (!item) throw notFound('Item')
  if (!item.imageId) throw bad('This item has no picture yet')
  if (!item.family) throw bad('Set the family first (e.g. IV cannula)')
  const f = { _id: { $ne: item._id }, family: item.family, ...(all ? {} : { $or: [{ imageId: null }, { imageId: { $exists: false } }] }) }
  const res = await Equipment.updateMany(f, { $set: { imageId: item.imageId } })
  forgetMaster()
  await audit(user, 'equipment.image_family', 'equipment', item._id, { after: { family: item.family, copiedTo: res.modifiedCount, all: !!all }, label: item.name }, clientMeta(req, user))
  return { ok: true, count: res.modifiedCount }
})
