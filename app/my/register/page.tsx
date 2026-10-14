import type { Metadata } from 'next'
import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getPatient } from '@/lib/patient-auth'
import { AuthShell } from '@/components/patient/PortalShell'
import { PatientRegisterForm } from '@/components/patient/AuthForms'

export const metadata: Metadata = { title: 'Create patient account' }

export default async function PatientRegister() {
  if (await getPatient()) redirect('/my')
  return (
    <AuthShell>
      <Suspense>
        <PatientRegisterForm />
      </Suspense>
    </AuthShell>
  )
}
