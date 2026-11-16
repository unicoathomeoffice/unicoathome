import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientRequests, toCard } from '@/lib/services/patients-portal'
import { patientModule } from '@/lib/services/patient-module'
import { PortalShell } from '@/components/patient/PortalShell'
import { OverviewView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'My home care' }

const DONE = ['COMPLETED', 'CLOSED', 'CANCELLED']

/** Patient overview: who they are (UHID), the numbers, next visit, current requests, latest vitals, bKash when due. */
export default async function MyHomeCare() {
  const patient = await requirePatient('/my')
  const [s, rows, m] = await Promise.all([getSettings(), patientRequests(patient), patientModule(patient)])
  const current = rows.filter((r) => !DONE.includes(r.status)).map(toCard)
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <OverviewView m={m} name={patient.name} current={current} />
    </PortalShell>
  )
}
