import { route } from '@/lib/api'
import { Notification, isOid } from '@/lib/models'

/** PATCH /api/v1/notifications/:id — mark read */
export const PATCH = route<{ id: string }>(async ({ user, params }) => {
  if (isOid(params.id)) await Notification.updateOne({ _id: params.id, userId: user.id }, { readAt: new Date() })
  return { ok: true }
})
