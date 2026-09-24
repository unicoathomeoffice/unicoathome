import { redirect } from 'next/navigation'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { FHeader, vHref, fullAddress } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { CheckInForm } from '@/components/field/checkin'
import { getSettings } from '@/lib/settings'

export const metadata = { title: 'Check-in' }

/** M07 Check-in */
export default async function CheckIn({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, patient, team } = await loadVisit(id)
  if (!team) redirect(vHref(id))
  if (r.status === 'IN_PROGRESS') redirect(vHref(id, 'checklist'))
  const s = await getSettings()
  const address = fullAddress(patient, r.patientSnapshot?.address)
  return (
    <MScreen header={<FHeader back={vHref(id)} title="Check-in" sub={`${r.requestNo} · ${r.patientSnapshot?.name}`} />}>
      <Col>
      <CheckInForm id={id} status={r.status} scheduledAt={r.scheduledAt} patient={r.patientSnapshot?.name} area={r.patientSnapshot?.area} address={address} lateAfter={s.sla.lateAfterMin} />
      </Col>
    </MScreen>
  )
}
