import { requireWebUser } from '@/lib/auth'
import { HomecareRequest, Notification } from '@/lib/models'
import { ROLE_LABEL, ACTIVE_STATUSES } from '@/lib/constants'
import { Sidebar } from '@/components/admin/Sidebar'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWebUser()
  const [open, unread] = await Promise.all([
    HomecareRequest.countDocuments({ status: { $in: ACTIVE_STATUSES }, deletedAt: null }),
    Notification.countDocuments({ userId: user.id, readAt: null }),
  ])
  return (
    <div className="flex h-dvh overflow-hidden bg-page">
      <Sidebar user={{ name: user.name, initials: user.initials, role: user.role, roleLabel: user.designation ?? ROLE_LABEL[user.role] }} counts={{ open, unread }} />
      {children}
    </div>
  )
}
