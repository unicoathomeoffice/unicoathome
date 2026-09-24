import { MScreen } from '@/components/mobile'
import { loadVisit } from '@/components/field/data'
import { PhotoManager } from '@/components/field/photos'

export const metadata = { title: 'Photos' }

const KINDS = ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO']

/** M11 Photos */
export default async function Photos({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team, user, attachments } = await loadVisit(id, { attachments: true })
  const tiles = attachments
    .filter((a: any) => KINDS.includes(a.kind))
    .map((a: any) => ({ _id: a._id, kind: a.kind, at: a.at, mine: String(a.uploadedBy) === user.id || ['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role) }))
  return (
    <MScreen pad={false}>
      <PhotoManager
        id={id}
        patient={r.patientSnapshot?.name}
        tiles={tiles}
        editable={team && ['IN_PROGRESS', 'COMPLETED'].includes(r.status)}
        backHref={r.status === 'IN_PROGRESS' ? `/m/visits/${id}/checklist` : `/m/visits/${id}`}
      />
    </MScreen>
  )
}
