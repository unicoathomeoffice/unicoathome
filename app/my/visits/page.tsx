import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientRequests, toCard } from '@/lib/services/patients-portal'
import { PortalShell } from '@/components/patient/PortalShell'
import { VisitsView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'My visits' }

const DONE = ['COMPLETED', 'CLOSED', 'CANCELLED']

/** Every visit: current requests with progress, and previous visits. */
export default async function MyVisits() {
  const patient = await requirePatient('/my/visits')
  const [s, rows] = await Promise.all([getSettings(), patientRequests(patient)])
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <VisitsView current={rows.filter((r) => !DONE.includes(r.status)).map(toCard)} past={rows.filter((r) => DONE.includes(r.status)).map(toCard)} />
    </PortalShell>
  )
}
