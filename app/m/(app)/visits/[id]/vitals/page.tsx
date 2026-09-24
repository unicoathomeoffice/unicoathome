import { MScreen } from '@/components/mobile'
import { loadVisit } from '@/components/field/data'
import { VitalsForm } from '@/components/field/vitals'
import { HomecareRequest } from '@/lib/models'

export const metadata = { title: 'Vitals' }

/** M09 Vitals */
export default async function Vitals({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team } = await loadVisit(id)
  const vit = r.visit?.vitals ?? {}
  const prev = await HomecareRequest.findOne({ patientId: r.patientId, _id: { $ne: r._id }, 'visit.vitals.weightKg': { $ne: null } })
    .sort({ 'visit.vitals.recordedAt': -1 })
    .select('visit.vitals.weightKg')
    .lean<any>()
  const vitalsItem = (r.visit?.checklist ?? []).find((c: any) => /vital/i.test(c.key) && !c.done)
  return (
    <MScreen pad={false}>
      <VitalsForm
        id={id}
        initial={vit}
        editable={team && r.status === 'IN_PROGRESS'}
        patient={r.patientSnapshot?.name}
        recordedAt={vit.recordedAt}
        checkInAt={r.status === 'IN_PROGRESS' ? r.timeline?.checkInAt : undefined}
        lastWeight={prev?.visit?.vitals?.weightKg ?? null}
        vitalsKey={vitalsItem?.key ?? null}
        flagged={vit.flagged && !vit.abnormal?.length}
      />
    </MScreen>
  )
}
