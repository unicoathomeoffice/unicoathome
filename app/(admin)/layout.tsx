import { requireWebUser } from '@/lib/auth'
import { Equipment, HomecareRequest, StoreLoan } from '@/lib/models'
import { unreadCount } from '@/lib/unread'
import { ROLE_LABEL, ACTIVE_STATUSES, permissionsFor } from '@/lib/constants'
import { Sidebar } from '@/components/admin/Sidebar'
import { WaReviewProvider } from '@/components/client/WaReview'
import { can } from '@/lib/constants'
import { getSettings } from '@/lib/settings'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireWebUser()
  // Not awaited: the sidebar and page render straight away and the two badges stream in when the counts arrive.
  const counts = Promise.all([
    HomecareRequest.countDocuments({ status: { $in: ACTIVE_STATUSES }, deletedAt: null }),
    unreadCount(user.id), // shared with AdminPage's bell — one query per request
    // store items low (at / below their alert level) or out of stock
    Equipment.countDocuments({ isActive: { $ne: false }, $or: [{ stock: { $lte: 0 } }, { $expr: { $and: [{ $gt: ['$alertBelow', 0] }, { $lte: ['$stock', '$alertBelow'] }] } }] }),
    StoreLoan.countDocuments({ status: { $in: ['OPEN', 'PARTLY_RETURNED'] }, dueAt: { $lt: new Date() } }), // overdue loans
  ]).then(([open, unread, store, overdueLoans]) => ({ open, unread, store: store + overdueLoans }))
  // admins approve every WhatsApp: the "Review & send" window opens after any click that created messages
  const review = can(user, 'messages.approve') && (await getSettings()).whatsapp.approval !== 'OFF'
  return (
    <div className="flex h-dvh overflow-hidden bg-page">
      {review && <WaReviewProvider />}
      <Sidebar user={{ name: user.name, initials: user.initials, photoUrl: user.photoUrl, perms: permissionsFor(user), roleLabel: user.designation ?? ROLE_LABEL[user.role] }} counts={counts} />
      {children}
    </div>
  )
}
