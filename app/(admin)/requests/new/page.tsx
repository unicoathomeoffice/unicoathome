import { requireWebUser } from '@/lib/auth'
import { can } from '@/lib/constants'
import { Counter, HomecareRequest, isOid, Patient, ServiceType, Zone } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { plain } from '@/lib/db'
import { isoDay } from '@/lib/format'
import { AdminPage } from '@/components/admin/AdminPage'
import { RequestForm, type FormPatient } from '@/components/request-form/RequestForm'

export const metadata = { title: 'New request · Unico HomeCare' }

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  const user = await requireWebUser('requests.create')
  const { patientId } = await searchParams
  const ymd = isoDay().replace(/-/g, '').slice(2)
  const [settings, services, zones, counter, pre] = await Promise.all([
    getSettings(),
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name category fee defaultDurationMin').lean<any[]>(),
    Zone.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('name').lean<any[]>(),
    Counter.findOne({ key: `HC-${ymd}` }).lean<any>(),
    patientId && isOid(patientId) ? Patient.findOne({ _id: patientId, deletedAt: null }).lean<any>() : null,
  ])

  let patient: FormPatient | null = null
  if (pre) {
    const latest = await HomecareRequest.find({ patientId: pre._id, deletedAt: null }).sort({ createdAt: -1 }).select('requestNo status scheduledAt').limit(1).lean<any[]>()
    const count = await HomecareRequest.countDocuments({ patientId: pre._id, deletedAt: null })
    patient = plain({ ...pre, latest: latest[0] ? { requestId: latest[0]._id, requestNo: latest[0].requestNo, status: latest[0].status, scheduledAt: latest[0].scheduledAt, count } : null })
  }

  return (
    <AdminPage title="New request" crumbs="Requests · New">
      <RequestForm
        nextNo={`HC-${ymd}-${String((counter?.seq ?? 0) + 1).padStart(4, '0')}`}
        today={isoDay()}
        slots={settings.general.slots}
        zones={zones.map((z) => z.name)}
        services={services.map((s) => ({ code: s.code, name: s.name, category: s.category ?? '', fee: s.fee ?? 0, duration: s.defaultDurationMin ?? 45 }))}
        initialPatient={patient}
        canConfirm={can(user, 'requests.manage')}
        canAssign={can(user, 'requests.assign')}
      />
    </AdminPage>
  )
}
