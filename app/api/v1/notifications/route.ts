import { route, qp } from '@/lib/api'
import { Notification } from '@/lib/models'
import { plain } from '@/lib/db'

/** GET /api/v1/notifications?unread=1&type=ASSIGNED&limit=50 */
export const GET = route(async ({ req, user }) => {
  const p = qp(req)
  const f: Record<string, any> = { userId: user.id }
  if (p.get('unread') === '1') f.readAt = null
  if (p.get('type')) f.type = { $in: p.get('type')!.split(',') }
  const [items, unread] = await Promise.all([
    Notification.find(f).sort({ createdAt: -1 }).limit(Math.min(Number(p.get('limit') ?? 50), 200)).lean(),
    Notification.countDocuments({ userId: user.id, readAt: null }),
  ])
  return { items: plain(items), unread }
})

/** POST /api/v1/notifications — mark all read */
export const POST = route(async ({ user }) => {
  await Notification.updateMany({ userId: user.id, readAt: null }, { readAt: new Date() })
  return { ok: true }
})
