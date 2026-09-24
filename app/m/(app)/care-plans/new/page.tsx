import { MScreen } from '@/components/mobile'
import { CarePlanForm } from '@/components/coord/CarePlan'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { Patient, ServiceType, isOid } from '@/lib/models'

export const metadata = { title: 'New care plan' }

/** P1 — create a recurring care plan (?patientId= prefills the patient). */
export default async function NewCarePlan({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  await requireAppUser('requests.create')
  await db()
  const sp = await searchParams
  const [services, patient] = await Promise.all([
    ServiceType.find({ isActive: { $ne: false } }).sort({ sortOrder: 1, name: 1 }).select('code name defaultDurationMin').lean<any[]>(),
    sp.patientId && isOid(sp.patientId) ? Patient.findOne({ _id: sp.patientId, deletedAt: null }).select('name ageYears gender phone uhid address').lean<any>() : null,
  ])
  return (
    <MScreen title="New care plan" sub="Recurring visits · each one confirmed as usual" back={patient ? '/m/admin/patients' : '/m/care-plans'}>
      <CarePlanForm services={plain(services)} initialPatient={patient ? plain(patient) : null} />
    </MScreen>
  )
}
