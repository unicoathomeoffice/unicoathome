import { requireWebUser } from '@/lib/auth'
import { HomecareRequest } from '@/lib/models'
import { unreadCount } from '@/lib/unread'
import { ROLE_LABEL, ACTIVE_STATUSES, permissionsFor } from '@/lib/constants'
import { Sidebar } from '@/components/admin/Sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWebUser()
  // Not awaited: the sidebar and page render straight away and the two badges stream in when the counts arrive.
  const counts = Promise.all([
    HomecareRequest.countDocuments({ status: { $in: ACTIVE_STATUSES }, deletedAt: null }),
    unreadCount(user.id), // shared with AdminPage's bell — one query per request
  ]).then(([open, unread]) => ({ open, unread }))
  return (
    <div className="flex h-dvh overflow-hidden bg-page">
      <Sidebar user={{ name: user.name, initials: user.initials, perms: permissionsFor(user), roleLabel: user.designation ?? ROLE_LABEL[user.role] }} counts={counts} />
      {children}
    </div>
  )
}
