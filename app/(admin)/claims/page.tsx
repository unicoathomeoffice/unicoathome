import { requireWebUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { ExpenseClaim, User } from '@/lib/models'
import { AdminPage } from '@/components/admin/AdminPage'
import { ClaimsAdmin } from '@/components/request-detail/ClaimsAdmin'

export const metadata = { title: 'Claims · Unico HomeCare' }

/** Staff expense claims (Bill Submission / Conveyance / Food) — review, approve, mark paid, download the forms. */
export default async function ClaimsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireWebUser('approvals.decide')
  await db()
  const { status } = await searchParams
  const f: any = { status: status && ['SUBMITTED', 'APPROVED', 'REJECTED', 'PAID'].includes(status) ? status : { $ne: 'DRAFT' } }
  const items = await ExpenseClaim.find(f).sort({ submittedAt: -1 }).limit(300).lean<any[]>()
  const users = await User.find({ _id: { $in: items.map((c) => c.userId) } }).select('name employeeId').lean<any[]>()
  const rows = items.map((c) => ({ ...c, user: users.find((u) => String(u._id) === String(c.userId)) ?? null }))
  return (
    <AdminPage title="Claims" crumbs="Travel, food & other expenses">
      <ClaimsAdmin rows={plain(rows)} status={status ?? ''} />
    </AdminPage>
  )
}
