import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getPatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { AuthShell } from '@/components/patient/PortalShell'
import { PatientLoginForm } from '@/components/patient/AuthForms'

export const metadata: Metadata = { title: 'Patient sign in' }

export default async function PatientLogin() {
  if (await getPatient()) redirect('/my')
  const s = await getSettings()
  return (
    <AuthShell>
      <Suspense>
        <PatientLoginForm hotline={s.general.hospitalPhone} />
      </Suspense>
    </AuthShell>
  )
}
