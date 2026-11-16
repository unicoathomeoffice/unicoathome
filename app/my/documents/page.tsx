import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientModule } from '@/lib/services/patient-module'
import { PortalShell } from '@/components/patient/PortalShell'
import { DocsView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'Reports & documents' }

/** Reports, prescriptions, visit reports and bills from the visits (view only). */
export default async function DocsPage() {
  const patient = await requirePatient('/my/documents')
  const [s, m] = await Promise.all([getSettings(), patientModule(patient)])
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <DocsView m={m} />
    </PortalShell>
  )
}
