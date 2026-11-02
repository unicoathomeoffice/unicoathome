import { route, clientMeta } from '@/lib/api'
import { audit } from '@/lib/audit'
import { forgetAuth } from '@/lib/auth'
import { clearUserPhoto, setUserPhoto } from '@/lib/avatars'

/** POST (multipart `file`) — set my profile photo (Account page / field app profile). */
export const POST = route(async ({ req, user }) => {
  const r = await setUserPhoto(req, user.id, user.id)
  forgetAuth()
  await audit(user, 'user.photo_set', 'user', user.id, { before: { photoUrl: r.before }, after: { photoUrl: r.url }, label: user.name }, clientMeta(req, user))
  return { url: r.url }
})

/** DELETE — remove my profile photo (back to initials). */
export const DELETE = route(async ({ req, user }) => {
  const r = await clearUserPhoto(user.id)
  forgetAuth()
  await audit(user, 'user.photo_remove', 'user', user.id, { before: { photoUrl: r.before }, label: user.name }, clientMeta(req, user))
  return { ok: true }
})
