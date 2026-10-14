import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const revalidate = 3600 // picks up hospital name / phone edits from Settings
export const metadata: Metadata = { title: 'Terms of use' }

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="14 October 2026">
      {(g) => (
        <>
          <p>
            Unico HomeCare is an internal system of {g.name} for managing home-care visits. By signing in you agree to these terms and to the hospital’s policies on patient confidentiality.
          </p>

          <h2>Who may use it</h2>
          <p>Only staff given an account by the hospital. Accounts are personal: do not share your password or let others act under your sign-in.</p>

          <h2>Using patient information</h2>
          <ul>
            <li>Open and use patient information only for the care, scheduling or billing of that patient.</li>
            <li>Record visits, notes and vital signs accurately and promptly.</li>
            <li>Do not copy, photograph, export or share patient information outside the system except as your role and hospital policy allow.</li>
          </ul>

          <h2>Monitoring</h2>
          <p>Sign-ins and changes are logged, and check-in / check-out times and locations are recorded, so the hospital can audit care and keep the system secure.</p>

          <h2>Availability</h2>
          <p>The hospital aims to keep the system available but may change, suspend or withdraw it. If it is unavailable, follow the Home Care desk’s backup procedure.</p>

          <h2>Accounts</h2>
          <p>The hospital may suspend or remove an account at any time, for example when a staff member leaves or misuses the system.</p>

          <h2>Contact</h2>
          <p>
            {g.name} · {g.dept} · {g.phone}
          </p>
        </>
      )}
    </LegalPage>
  )
}
