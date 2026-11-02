import { z } from 'zod'
import { route, body, bad, clientMeta } from '@/lib/api'
import { Attachment, User } from '@/lib/models'
import { audit } from '@/lib/audit'
import { forgetAuth } from '@/lib/auth'
import { storeFile } from '@/lib/files'

/**
 * My e-signature (Account page). PNG/JPG, drawn or uploaded (background already trimmed in the browser).
 * It is stamped on forms only for actions this user performs; `autoSignApprover` lets a dept. head be stamped as
 * the approver on car requisitions.
 */
export const POST = route(async ({ req, user }) => {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) throw bad('No signature image')
  if (!/^image\/(png|jpeg)$/.test(file.type)) throw bad('Use a PNG or JPG image')
  if (file.size > 600 * 1024) throw bad('The signature image is too large (max 600 KB)')
  const prev = await User.findById(user.id).select('signatureId').lean<any>()
  const a = await storeFile({ data: Buffer.from(await file.arrayBuffer()), mime: file.type, filename: `signature-${user.employeeId}.${file.type === 'image/png' ? 'png' : 'jpg'}`, kind: 'SIGNATURE', ownerType: 'USER', ownerId: user.id, uploadedBy: user.id, caption: 'E-signature' })
  await User.updateOne({ _id: user.id }, { signatureId: a._id })
  if (prev?.signatureId) await Attachment.updateOne({ _id: prev.signatureId }, { deletedAt: new Date() })
  await audit(user, 'user.signature_set', 'user', user.id, { after: { attachmentId: String(a._id) }, label: user.name }, clientMeta(req, user))
  return { id: String(a._id) }
})

/** DELETE — remove my e-signature (forms are then left for a wet signature). */
export const DELETE = route(async ({ req, user }) => {
  const u = await User.findById(user.id).select('signatureId').lean<any>()
  if (u?.signatureId) await Attachment.updateOne({ _id: u.signatureId }, { deletedAt: new Date() })
  await User.updateOne({ _id: user.id }, { $unset: { signatureId: 1 }, autoSignApprover: false })
  await audit(user, 'user.signature_remove', 'user', user.id, { label: user.name }, clientMeta(req, user))
  return { ok: true }
})

/** PATCH { autoSignApprover } — allow my signature to be stamped as approver on car requisitions. */
export const PATCH = route(async ({ req, user }) => {
  const input = await body(req, z.object({ autoSignApprover: z.boolean() }))
  await User.updateOne({ _id: user.id }, { autoSignApprover: input.autoSignApprover })
  forgetAuth()
  await audit(user, 'user.signature_approver', 'user', user.id, { after: input, label: user.name }, clientMeta(req, user))
  return { ok: true }
})
