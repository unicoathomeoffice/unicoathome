import { MScreen } from '@/components/mobile'
import { loadVisit } from '@/components/field/data'
import { NotesEditor } from '@/components/field/notes'
import { User } from '@/lib/models'

export const metadata = { title: 'Notes & medications' }

const short = (n?: string) => {
  if (!n) return ''
  const p = n.replace(/^(Dr\.?|Md\.?|Mst\.?)\s+/i, '').split(/\s+/)
  return p.length > 1 ? `${p[0]} ${p[1][0]}.` : p[0]
}

/** M10 Notes & medications */
export default async function Notes({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { r, team, user } = await loadVisit(id)
  const v = r.visit ?? {}
  const meds: any[] = v.medications ?? []
  const people = await User.find({ _id: { $in: meds.map((m) => m.by).filter(Boolean) } }).select('name').lean<any[]>()
  const name = (id: string) => short(people.find((p) => String(p._id) === String(id))?.name)
  return (
    <MScreen pad={false}>
      <NotesEditor
        id={id}
        editable={team && ['IN_PROGRESS', 'COMPLETED'].includes(r.status) && r.status !== 'CLOSED'}
        title="Notes & medications"
        sub={`${r.patientSnapshot?.name} · ${r.requestNo}`}
        defaultTab={user.role === 'DOCTOR' ? 'clinical' : 'nursing'}
        initial={{ nursing: v.notes?.nursing ?? '', clinical: v.notes?.clinical ?? '', remarks: v.remarks ?? '', consumables: v.consumables ?? [], updatedAt: v.notes?.updatedAt }}
        meds={meds.map((m) => ({ ...m, byName: name(m.by) }))}
      />
    </MScreen>
  )
}
