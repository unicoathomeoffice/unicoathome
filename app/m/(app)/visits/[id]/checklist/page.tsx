import { MScreen } from '@/components/mobile'
import { svcName } from '@/components/field'
import { loadVisit } from '@/components/field/data'
import { ChecklistScreen } from '@/components/field/checklist'
import { Attachment } from '@/lib/models'

export const metadata = { title: 'Checklist' }

/** M08 Checklist (M08-e) */
export default async function Checklist({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team } = await loadVisit(id)
  const v = r.visit ?? {}
  const vit = v.vitals ?? {}
  const vitalsLine = vit.recordedAt
    ? [vit.bpSys ? `BP ${vit.bpSys}/${vit.bpDia ?? '—'}` : null, vit.pulse ? `pulse ${vit.pulse}` : null, vit.spo2 ? `SpO₂ ${vit.spo2}%` : null, vit.rbs ? `RBS ${vit.rbs}` : null].filter(Boolean).join(' · ')
    : undefined
  const meds: any[] = v.medications ?? []
  const lastMed = meds[meds.length - 1]
  const medsLine = lastMed ? [lastMed.drug, lastMed.dose, lastMed.route].filter(Boolean).join(' · ') + (meds.length > 1 ? ` (+${meds.length - 1})` : '') : undefined
  const photos = await Attachment.countDocuments({ requestId: r._id, deletedAt: null, kind: { $in: ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO'] } })
  return (
    <MScreen pad={false}>
      <ChecklistScreen
        id={id}
        items={v.checklist ?? []}
        title="Checklist"
        sub={`${svcName(r)} · ${r.patientSnapshot?.name}`}
        editable={team && r.status === 'IN_PROGRESS'}
        status={r.status}
        checkInAt={r.timeline?.checkInAt}
        vitalsLine={vitalsLine}
        vitalsAt={vit.recordedAt}
        medsLine={medsLine}
        photos={photos}
        confirmed={!!v.confirmation?.at}
      />
    </MScreen>
  )
}
