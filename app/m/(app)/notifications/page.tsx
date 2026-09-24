import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { AutoRefresh } from '@/components/client'
import { FHeader } from '@/components/field'
import { NotificationList, MarkAllRead, type NItem } from '@/components/field/notifications'
import { isDesk } from '@/components/field/data'
import { requireAppUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { Notification } from '@/lib/models'
import { dayNum, isoDay, time } from '@/lib/format'

export const metadata = { title: 'Notifications' }

/** Map a notification's target (web or app path) to a field-app path. */
function toAppPath(url: string | undefined, requestId: string | undefined, role: string): string | null {
  if (url?.startsWith('/m')) return url
  const m = url?.match(/^\/requests\/([a-f0-9]{24})(.*)$/i)
  if (m) return `/m/visits/${m[1]}${/tab=chat/.test(m[2]) ? '/chat' : ''}`
  if (url?.startsWith('/settings/approvals')) return isDesk(role) ? '/m/admin' : requestId ? `/m/visits/${requestId}` : null
  if (requestId) return `/m/visits/${requestId}`
  return null
}

function when(at: Date) {
  const k = isoDay(at)
  if (k === isoDay()) return time(at)
  if (k === isoDay(Date.now() - 86400_000)) return 'Yesterday'
  if (Date.now() - at.getTime() < 6 * 86400_000) return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', weekday: 'short' }).format(at)
  return dayNum(at)
}

/** M14 Notifications */
export default async function Notifications() {
  const user = await requireAppUser()
  await db()
  const rows = await Notification.find({ userId: user.id }).sort({ createdAt: -1 }).limit(100).lean<any[]>()
  const today = isoDay()
  const items: NItem[] = rows.map((n) => ({
    _id: String(n._id),
    type: n.type ?? 'SYSTEM',
    title: n.title ?? '',
    body: n.body ?? undefined,
    priority: n.priority,
    readAt: n.readAt ? new Date(n.readAt).toISOString() : null,
    href: toAppPath(n.data?.url, n.data?.requestId ? String(n.data.requestId) : undefined, user.role),
    when: when(new Date(n.createdAt)),
    today: isoDay(n.createdAt) === today,
  }))
  return (
    <MScreen tab="notifications" header={<FHeader title="Notifications" right={items.some((i) => !i.readAt) ? <MarkAllRead /> : null} />}>
      <Col>
      <AutoRefresh seconds={30} />
      <NotificationList items={items} />
      </Col>
    </MScreen>
  )
}
