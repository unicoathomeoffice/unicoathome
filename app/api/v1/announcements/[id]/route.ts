import { z } from 'zod'
import { route, body, clientMeta, forbidden, notFound } from '@/lib/api'
import { can } from '@/lib/constants'
import { Announcement, isOid } from '@/lib/models'
import { audit } from '@/lib/audit'

const Patch = z.object({
  seen: z.boolean().optional(),
  active: z.boolean().optional(),
  pinned: z.boolean().optional(),
  title: z.string().trim().min(2).max(120).optional(),
  body: z.string().trim().max(2000).optional(),
  endAt: z.string().nullable().optional(),
})

/** PATCH /api/v1/announcements/:id — { seen: true } by anyone it is for; edits / end / pin by announcements.manage. */
export const PATCH = route<{ id: string }>(async ({ req, user, params }) => {
  if (!isOid(params.id)) throw notFound('Announcement')
  const i = await body(req, Patch)
  const a = await Announcement.findOne({ _id: params.id, deletedAt: null })
  if (!a) throw notFound('Announcement')
  if (i.seen) await Announcement.updateOne({ _id: a._id }, { $addToSet: { seenBy: user.id } })
  const edits = { active: i.active, pinned: i.pinned, title: i.title, body: i.body, endAt: i.endAt === null ? null : i.endAt ? new Date(i.endAt) : undefined }
  if (Object.values(edits).some((v) => v !== undefined)) {
    if (!can(user, 'announcements.manage')) throw forbidden()
    for (const [k, v] of Object.entries(edits)) if (v !== undefined) a.set(k, v)
    await a.save()
    await audit(user, 'announcement.update', 'announcement', a._id, { after: edits, label: a.title }, clientMeta(req, user))
  }
  return { ok: true }
})

/** DELETE /api/v1/announcements/:id — take it down (announcements.manage). */
export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'announcements.manage')) throw forbidden()
  if (!isOid(params.id)) throw notFound('Announcement')
  const a = await Announcement.findOneAndUpdate({ _id: params.id, deletedAt: null }, { deletedAt: new Date(), active: false })
  if (!a) throw notFound('Announcement')
  await audit(user, 'announcement.delete', 'announcement', a._id, { label: a.title }, clientMeta(req, user))
  return { ok: true }
})
