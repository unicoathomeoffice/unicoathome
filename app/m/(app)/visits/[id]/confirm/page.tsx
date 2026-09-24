import { MScreen } from '@/components/mobile'
import { checklistStats } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { ConfirmScreen } from '@/components/field/confirm'
import { getSettings } from '@/lib/settings'

export const metadata = { title: 'Patient confirmation' }

/** M12 Patient confirmation */
export default async function Confirm({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, patient, team } = await loadVisit(id)
  const s = await getSettings()
  const ck = checklistStats(r)
  const nextHref = r.status === 'IN_PROGRESS' ? (ck.missing.length ? `/m/visits/${id}/checklist` : `/m/visits/${id}/checkout`) : `/m/visits/${id}`
  return (
    <MScreen pad={false}>
      <ConfirmScreen
        id={id}
        requestNo={r.requestNo}
        patient={r.patientSnapshot?.name}
        guardian={patient?.guardian ?? null}
        existing={r.visit?.confirmation ?? null}
        editable={team && r.status === 'IN_PROGRESS'}
        nextHref={nextHref}
        otpEnabled={s.features.otpConfirmation !== false}
      />
    </MScreen>
  )
}
