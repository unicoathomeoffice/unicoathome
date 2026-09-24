import { route } from '@/lib/api'
import { Notification } from '@/lib/models'

export const GET = route(async ({ user }) => {
  const unread = await Notification.countDocuments({ userId: user.id, readAt: null })
  return { user, unread }
})
