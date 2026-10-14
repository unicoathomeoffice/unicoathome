import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { readSignup, SIGNUP_COOKIE } from '@/lib/google-auth'
import { getPatient } from '@/lib/patient-auth'
import { AuthShell } from '@/components/patient/PortalShell'
import { CompleteGoogleForm } from '@/components/patient/AuthForms'

export const metadata: Metadata = { title: 'Complete your account' }

/** After "Continue with Google" for a new patient: we still need the mobile + WhatsApp numbers. */
export default async function CompleteAccount() {
  if (await getPatient()) redirect('/my')
  const g = await readSignup((await cookies()).get(SIGNUP_COOKIE)?.value)
  if (!g) redirect(`/my/login?error=${encodeURIComponent('Your Google sign-in expired. Please continue with Google again.')}`)
  return (
    <AuthShell>
      <CompleteGoogleForm name={g.name} email={g.email} picture={g.picture} />
    </AuthShell>
  )
}
