import { route, clientMeta, forbidden, notFound } from '@/lib/api'
import { audit } from '@/lib/audit'
import { can } from '@/lib/constants'
import { forgetAuth } from '@/lib/auth'
import { isOid } from '@/lib/models'
import { clearUserPhoto, setUserPhoto } from '@/lib/avatars'

/** POST (multipart `file`) — an admin sets a staff member's profile photo (Staff → edit). */
export const POST = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'users.manage') && params.id !== user.id) throw forbidden()
  if (!isOid(params.id)) throw notFound('User')
  const r = await setUserPhoto(req, params.id, user.id)
  forgetAuth()
  await audit(user, 'user.photo_set', 'user', params.id, { before: { photoUrl: r.before }, after: { photoUrl: r.url } }, clientMeta(req, user))
  return { url: r.url }
})

export const DELETE = route<{ id: string }>(async ({ req, user, params }) => {
  if (!can(user, 'users.manage') && params.id !== user.id) throw forbidden()
  if (!isOid(params.id)) throw notFound('User')
  const r = await clearUserPhoto(params.id)
  forgetAuth()
  await audit(user, 'user.photo_remove', 'user', params.id, { before: { photoUrl: r.before } }, clientMeta(req, user))
  return { ok: true }
})
