import { MScreen } from '@/components/mobile'
import { loadVisit } from '@/components/field/data'
import { RxScreen } from '@/components/field/rx'
import { Designation, LabResult, Prescription, User } from '@/lib/models'
import { isTeamMember } from '@/lib/services/requests'
import { can } from '@/lib/constants'
import { plain } from '@/lib/db'

export const metadata = { title: 'Prescription & results' }

/** L1 (6f) Prescription & lab results */
export default async function RxPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const { r, user, team } = await loadVisit(id)
  const [rx, rows] = await Promise.all([Prescription.findOne({ requestId: r._id }).sort({ createdAt: -1 }).lean<any>(), LabResult.find({ requestId: r._id }).sort({ createdAt: 1 }).lean<any[]>()])
  let doctor: any = null
  if (rx?.doctorId) {
    const u = await User.findById(rx.doctorId).select('name employeeId designationId').lean<any>()
    const d = u?.designationId ? await Designation.findById(u.designationId).select('title').lean<any>() : null
    if (u) doctor = { name: u.name, employeeId: u.employeeId, designation: d?.title ?? 'Doctor' }
  }
  const have = new Set(rows.map((x) => x.test))
  const labs = [...plain(rows), ...(r.tests ?? []).filter((t: string) => !have.has(t)).map((t: string) => ({ _id: null, test: t, status: 'NOT_SENT' }))]
  const canEdit = user.role === 'DOCTOR' && isTeamMember(user, r)
  return (
    <MScreen pad={false}>
      <RxScreen
        id={id}
        title="Prescription & results"
        sub={`${r.patientSnapshot?.name} · ${r.requestNo}`}
        tab={sp.tab === 'labs' || (!rx && user.role !== 'DOCTOR' && labs.length) ? 'labs' : 'rx'}
        rx={plain(rx)}
        doctor={doctor}
        me={{ name: user.name, employeeId: user.employeeId, designation: user.designation }}
        canEdit={canEdit}
        labs={labs}
        canEnter={team || can(user, 'requests.manage')}
        sampleAt={r.timeline?.checkInAt ?? null}
      />
    </MScreen>
  )
}
