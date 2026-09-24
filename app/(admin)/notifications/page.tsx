import type { Metadata } from 'next'
import { BellOff, Settings2 } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { Notification, oid } from '@/lib/models'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Empty, LinkButton, Tabs } from '@/components/ui'
import { NotificationList, MarkAllRead } from '@/components/comms/NotificationList'
import { isoDay } from '@/lib/format'

export const metadata: Metadata = { title: 'Notifications' }

/** W13 filter tabs → notification types */
const TABS: { key: string; label: string; types?: string[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'assignments', label: 'Assignments', types: ['ASSIGNED', 'ACCEPTED', 'DECLINED', 'REMINDER', 'TRANSPORT', 'EN_ROUTE', 'CHECK_IN'] },
  { key: 'escalations', label: 'Escalations', types: ['ESCALATION', 'OVERDUE'] },
  { key: 'vitals', label: 'Vitals flags', types: ['ABNORMAL_VITALS'] },
  { key: 'requests', label: 'Requests', types: ['REQUEST_CREATED', 'COMPLETED', 'RESCHEDULED', 'CANCELLED'] },
  { key: 'system', label: 'System', types: ['SYSTEM', 'APPROVAL', 'CHAT', 'DIGEST'] },
]

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string; unread?: string }> }) {
  const user = await requireWebUser()
  const sp = await searchParams
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0]
  const f: Record<string, any> = { userId: user.id }
  if (tab.types) f.type = { $in: tab.types }
  if (sp.unread === '1') f.readAt = null
  const [items, unread, byType] = await Promise.all([
    Notification.find(f).sort({ createdAt: -1 }).limit(150).lean<any[]>(),
    Notification.countDocuments({ userId: user.id, readAt: null }),
    Notification.aggregate([{ $match: { userId: oid(user.id), readAt: null } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
  ])
  const unreadIn = (types?: string[]) => (types ? byType.filter((x: any) => types.includes(x._id)).reduce((a: number, x: any) => a + x.n, 0) : unread)
  const href = (key: string, unreadOnly = sp.unread === '1') => {
    const q = new URLSearchParams()
    if (key !== 'all') q.set('tab', key)
    if (unreadOnly) q.set('unread', '1')
    const s = q.toString()
    return s ? `/notifications?${s}` : '/notifications'
  }
  const isAdmin = ['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role)

  return (
    <AdminPage title="Notifications">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Tabs
            active={tab.key}
            items={TABS.map((t) => {
              const n = unreadIn(t.types)
              return { key: t.key, label: t.key === 'all' ? `All · ${unread} unread` : t.label, href: href(t.key), count: t.key !== 'all' && n ? n : undefined }
            })}
          />
          <div className="flex-1" />
          <LinkButton href={href(tab.key, sp.unread !== '1')} kind={sp.unread === '1' ? 'k' : 'o'} className="h-[38px]">
            Unread
          </LinkButton>
          <MarkAllRead disabled={!unread} />
          <LinkButton href={isAdmin ? '/settings/notifications' : '/account'} kind="o" className="h-[38px]">
            <Settings2 size={16} />
            <span className="hidden 2xl:inline">Preferences</span>
          </LinkButton>
        </div>
        <div className="max-w-[880px]">
        {items.length ? (
          <NotificationList items={plain(items)} today={isoDay()} />
        ) : (
          <div className="rounded-card bg-white shadow-card">
            <Empty icon={<BellOff size={24} />} title={sp.unread === '1' ? 'No unread notifications' : 'No notifications here yet'} sub="Assignments, escalations, vitals flags and completed visits for you show up here." />
          </div>
        )}
        </div>
      </div>
    </AdminPage>
  )
}
