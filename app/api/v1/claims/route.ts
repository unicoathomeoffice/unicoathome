import { route } from '@/lib/api'
import { plain } from '@/lib/db'
import { can } from '@/lib/constants'
import { ExpenseClaim, User } from '@/lib/models'

/** GET /api/v1/claims — my claims, or (?all=1, approvers) everyone's submitted claims (?status=). */
export const GET = route(async ({ req, user }) => {
  const sp = req.nextUrl.searchParams
  const all = sp.get('all') === '1' && can(user, 'approvals.decide')
  const f: any = all ? { status: { $ne: 'DRAFT' } } : { userId: user.id }
  if (sp.get('status')) f.status = sp.get('status')
  const items = await ExpenseClaim.find(f).sort({ submittedAt: -1, updatedAt: -1 }).limit(200).lean<any[]>()
  const users = all ? await User.find({ _id: { $in: items.map((c) => c.userId) } }).select('name employeeId').lean<any[]>() : []
  return { items: plain(items.map((c) => ({ ...c, user: users.find((u) => String(u._id) === String(c.userId)) ?? null }))) }
})
