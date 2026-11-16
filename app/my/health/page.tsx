import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientModule } from '@/lib/services/patient-module'
import { PortalShell } from '@/components/patient/PortalShell'
import { HealthView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'Health records' }

/** Health records: vitals the team recorded at each visit, test results and medicines given at home (view only). */
export default async function HealthPage() {
  const patient = await requirePatient('/my/health')
  const [s, m] = await Promise.all([getSettings(), patientModule(patient)])
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <HealthView m={m} />
    </PortalShell>
  )
}
