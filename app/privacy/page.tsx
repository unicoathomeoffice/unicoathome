import type { Metadata } from 'next'
import { LegalPage } from '@/components/LegalPage'

export const revalidate = 3600 // picks up hospital name / phone edits from Settings
export const metadata: Metadata = { title: 'Privacy policy' }

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="14 October 2026">
      {(g) => (
        <>
          <p>
            Unico HomeCare is the home-care system of {g.name} ({g.dept}). It is used by our coordinators, front desk, doctors, nurses, allied health staff and drivers to arrange and record home visits. This policy explains what
            information the system holds and how it is used.
          </p>

          <h2>Information we hold</h2>
          <ul>
            <li>Patient details: name, phone numbers, age, gender, hospital ID (UHID), email, home address and, when recorded, the map location of the home.</li>
            <li>Visit records: requested services, schedule, clinical notes, vital signs, medicines given, test details, photos and documents attached to a visit, and billing.</li>
            <li>Staff details: name, employee ID, phone, email, role and duty status.</li>
            <li>Visit location stamps: when staff check in or out of a visit, the time and (if they allow it on their phone) the GPS position at that moment. Staff location is not tracked at other times.</li>
            <li>System logs: sign-ins and an audit trail of changes, used for security and accountability.</li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>To schedule, assign, carry out and record home visits, and to bill for them.</li>
            <li>To contact patients and families about their visits by phone, WhatsApp or email, and to send visit reports to the department.</li>
            <li>To guide staff and drivers to the patient’s home.</li>
            <li>To monitor service quality (response times, punctuality) and keep the system secure.</li>
          </ul>

          <h2>Google account data (email sending)</h2>
          <p>
            The hospital connects its own department Gmail account so the system can send visit confirmations and reports. Access is limited to sending email (the <code>gmail.send</code> permission). The system does not read,
            store, or delete anything in the mailbox, and Google user data is not used for advertising, sold, or shared with third parties. Use of information received from Google APIs adheres to the{' '}
            <a className="text-primary-700 underline" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements.
          </p>

          <h2>Who can see it</h2>
          <p>
            Only authorised hospital staff, each limited by their role. Field staff see only the visits they are assigned to. We do not sell personal information or use it for advertising.
          </p>

          <h2>Service providers</h2>
          <p>
            Data is stored with our hosting and database providers (Vercel and MongoDB Atlas). Maps and address search use OpenStreetMap and Google Maps; messages are sent through Gmail and WhatsApp. These providers process
            data only to deliver their service.
          </p>

          <h2>Keeping and protecting data</h2>
          <p>
            Medical and visit records are kept as part of the patient’s hospital record for as long as the law and our clinical policies require. Connections are encrypted, stored integration credentials are encrypted, and
            every change is logged.
          </p>

          <h2>Your choices</h2>
          <p>
            Patients may ask to see or correct their information, or to stop WhatsApp or email messages, by contacting the Home Care desk. Staff may switch off location sharing on their phone; visits are then stamped with
            time only.
          </p>

          <h2>Contact</h2>
          <p>
            {g.name} · {g.dept}
            <br />
            {g.address}
            <br />
            Phone: {g.phone}
          </p>
        </>
      )}
    </LegalPage>
  )
}
