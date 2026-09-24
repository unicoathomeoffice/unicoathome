import { MScreen } from '@/components/mobile'
import { NewRequestForm } from '@/components/coord/NewRequestForm'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { HomecareRequest, Patient, ServiceType, isOid } from '@/lib/models'
import { canView } from '@/lib/services/requests'
import { can, DESK_ROLES, FIELD_ROLES, ROLE_LABEL } from '@/lib/constants'
import { dhakaParts } from '@/components/coord/data'

export const metadata = { title: 'New request' }

/** M19 / S1 (5b) / M24 (3g) — every app user with requests.create. ?patientId= prefill · ?from=<requestId> follow-up. */
export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ patientId?: string; from?: string }> }) {
  const user = await requireAppUser('requests.create')
  await db()
  const sp = await searchParams
  const isDesk = DESK_ROLES.includes(user.role)
  let from: any = null
  let patientId = sp.patientId && isOid(sp.patientId) ? sp.patientId : undefined
  if (sp.from && isOid(sp.from)) {
    const r = await HomecareRequest.findOne({ _id: sp.from, deletedAt: null }).select('requestNo status patientId scheduledAt slot assignment createdBy transport').lean<any>()
    if (r && canView(user, r)) {
      const t = dhakaParts(r.scheduledAt)
      from = { id: String(r._id), requestNo: r.requestNo, status: r.status, time: t.time || undefined, slot: r.slot }
      patientId = patientId ?? String(r.patientId)
    }
  }
  const [services, patient] = await Promise.all([
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name fee defaultDurationMin category').lean<any[]>(),
    patientId ? Patient.findOne({ _id: patientId, deletedAt: null }).select('name ageYears gender phone uhid address').lean<any>() : null,
  ])
  const backHref = from ? (isDesk ? `/m/admin/requests/${from.id}` : `/m/visits/${from.id}`) : isDesk ? '/m/admin' : '/m'
  return (
    <MScreen>
      <NewRequestForm
        me={{
          name: user.name,
          initials: user.initials,
          designation: user.designation,
          employeeId: user.employeeId,
          roleLabel: ROLE_LABEL[user.role],
          isDesk,
          isField: FIELD_ROLES.includes(user.role),
          canConfirm: can(user, 'requests.manage'),
        }}
        services={plain(services)}
        initialPatient={patient ? plain(patient) : null}
        from={from}
        backHref={backHref}
      />
    </MScreen>
  )
}
