import { redirect } from 'next/navigation'
import { MScreen } from '@/components/mobile'
import { vHref } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { ChangeForm } from '@/components/field/change'
import { Approval } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { dayNum, dateTime } from '@/lib/format'

export const metadata = { title: 'Request change' }

/** R1 (6c) Request reschedule / cancel / hand over */
export default async function Change({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team } = await loadVisit(id)
  if (!team || ['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)) redirect(vHref(id))
  const [s, pending] = await Promise.all([
    getSettings(),
    Approval.find({ requestId: r._id, status: 'PENDING', type: { $in: ['RESCHEDULE', 'CANCEL', 'HANDOVER'] } }).sort({ createdAt: -1 }).lean<any[]>(),
  ])
  return (
    <MScreen pad={false}>
      <ChangeForm
        id={id}
        requestNo={r.requestNo}
        sub={`${r.requestNo} · ${r.patientSnapshot?.name}${r.scheduledAt ? ` · ${dayNum(r.scheduledAt)}` : ''}`}
        slots={s.general.slots}
        pending={pending.map((p) => ({ type: p.type, reason: p.reason ?? '', at: dateTime(p.createdAt) }))}
      />
    </MScreen>
  )
}
