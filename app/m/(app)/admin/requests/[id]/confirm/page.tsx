import { redirect } from 'next/navigation'
import { MScreen } from '@/components/mobile'
import { PriorityBadge } from '@/components/ui'
import { PatientSummaryCard } from '@/components/coord/blocks'
import { ConfirmForm } from '@/components/coord/ConfirmForm'
import { requireDesk, loadCoordRequest, dhakaParts } from '@/components/coord/data'
import { can } from '@/lib/constants'
import { isoDay } from '@/lib/format'

export const metadata = { title: 'Confirm request' }

/** S2 (5c) — Stage 2: coordinator calls the patient and confirms. */
export default async function ConfirmPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDesk('requests.manage')
  const { id } = await params
  const { r, patient } = await loadCoordRequest(id, user)
  if (!['NEW', 'VERIFIED'].includes(r.status)) redirect(`/m/admin/requests/${id}`)
  const sched = dhakaParts(r.scheduledAt)
  const date = sched.date || r.preferred?.date || isoDay()
  const time = sched.time || r.preferred?.time || (r.preferred?.slot ? `${r.preferred.slot.slice(0, 2)}:00` : '')
  return (
    <MScreen title="Confirm request" sub={`${r.requestNo} · ${r.patientSnapshot?.name}`} back={`/m/admin/requests/${id}`} right={<PriorityBadge priority={r.priority} />}>
      <PatientSummaryCard r={r} patient={patient} />
      <ConfirmForm
        id={id}
        requestNo={r.requestNo}
        date={date}
        time={time}
        slot={r.slot ?? r.preferred?.slot}
        uhid={r.patientSnapshot?.uhid ?? patient?.uhid}
        patientUhid={patient?.uhid}
        tests={r.tests ?? []}
        fee={r.billing?.estimatedFee}
        transport={!!r.transport?.needed}
        priority={r.priority}
        canAssign={can(user, 'requests.assign')}
      />
    </MScreen>
  )
}
