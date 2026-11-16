import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientModule } from '@/lib/services/patient-module'
import { PortalShell } from '@/components/patient/PortalShell'
import { SchedulesView } from '@/components/patient/ModuleViews'

export const metadata: Metadata = { title: 'Repeating visits' }

/** Repeating visits for the patient: the rule, progress and the next visits (view only). */
export default async function SchedulesPage() {
  const patient = await requirePatient('/my/schedules')
  const [s, m] = await Promise.all([getSettings(), patientModule(patient)])
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials, photoUrl: patient.photoUrl, uhid: patient.uhid }} hotline={s.general.hospitalPhone}>
      <SchedulesView m={m} />
    </PortalShell>
  )
}
