import Link from 'next/link'
import { CircleCheck } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { Approval, User } from '@/lib/models'
import { APPROVAL_TYPES, can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { listApprovals, APPROVAL_LABEL } from '@/lib/services/approvals'
import { AdminPage } from '@/components/admin/AdminPage'
import { Empty } from '@/components/ui'
import { FilterSelect } from '@/components/people/filters'
import { ApprovalsQueue } from '@/components/admin-settings/ApprovalsQueue'

export const metadata = { title: 'Approvals · Unico HomeCare' }

type SP = Promise<Record<string, string | undefined>>

export default async function ApprovalsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireWebUser('approvals.decide')
  const sp = await searchParams
  const status = sp.status ?? 'PENDING'
  const [items, pendingByType, requesterIds] = await Promise.all([
    listApprovals({ status, type: sp.type, requestedBy: sp.by }),
    Approval.aggregate([{ $match: { status: 'PENDING' } }, { $group: { _id: '$type', n: { $sum: 1 } } }]),
    Approval.distinct('requestedBy'),
  ])
  const requesters = await User.find({ _id: { $in: requesterIds } }).select('name').sort({ name: 1 }).lean<any[]>()
  const pending = pendingByType.reduce((s, x) => s + x.n, 0)

  return (
    <AdminPage title={`Approvals${pending ? ` · ${pending} pending` : ''}`} crumbs="Settings">
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <FilterSelect
          label="Type"
          param="type"
          options={APPROVAL_TYPES.map((t) => {
            const n = pendingByType.find((x) => x._id === t)?.n
            return { value: t, label: `${APPROVAL_LABEL[t]}${n ? ` (${n})` : ''}` }
          })}
        />
        <FilterSelect label="Requested by" param="by" options={requesters.map((u) => ({ value: String(u._id), label: u.name }))} />
        <FilterSelect
          label="Status"
          param="status"
          allLabel={`Pending · ${pending}`}
          options={[
            { value: 'APPROVED', label: 'Approved' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'ALL', label: 'All decisions' },
          ]}
        />
      </div>

      {items.length === 0 ? (
        <div className="rounded-card bg-white shadow-card">
          <Empty
            icon={<CircleCheck size={24} />}
            title={status === 'PENDING' ? 'Nothing waiting for a decision' : 'No approvals match these filters'}
            sub={status === 'PENDING' ? 'New users, reschedules, cancellations, handovers and petty cash requests appear here.' : undefined}
            action={
              sp.type || sp.by || sp.status ? (
                <Link href="/settings/approvals" className="text-sm font-semibold text-primary-700">
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ApprovalsQueue items={plain(items)} canUsers={can(user, 'users.manage')} />
      )}
      <p className="mt-4 text-[12.5px] text-slate-500">Every decision is written to the audit log with before / after and notifies the requester in-app. Approving a petty cash, cancellation or dated reschedule applies it to the visit immediately.</p>
    </AdminPage>
  )
}
