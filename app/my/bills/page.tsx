import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientModule } from '@/lib/services/patient-module'
import { PortalShell } from '@/components/patient/PortalShell'
import { BillsView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'Bills & payments' }

/** Bills on every visit (paid / due, the bill file) and the hospital bKash QR when something is due (view only). */
export default async function BillsPage() {
  const patient = await requirePatient('/my/bills')
  const [s, m] = await Promise.all([getSettings(), patientModule(patient)])
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <BillsView m={m} />
    </PortalShell>
  )
}
