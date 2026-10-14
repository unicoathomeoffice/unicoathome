import type { Metadata } from 'next'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientRequests, toCard } from '@/lib/services/patients-portal'
import { PortalShell } from '@/components/patient/PortalShell'
import { Greeting, HelpBar, NewRequestCta, RequestList, SectionTitle } from '@/components/patient/RequestCards'

export const metadata: Metadata = { title: 'My visits' }

const DONE = ['COMPLETED', 'CLOSED', 'CANCELLED']

/** Patient dashboard: new request, current requests with progress, previous visits. */
export default async function MyVisits() {
  const patient = await requirePatient('/my')
  const [s, rows] = await Promise.all([getSettings(), patientRequests(patient)])
  const current = rows.filter((r) => !DONE.includes(r.status)).map(toCard)
  const past = rows.filter((r) => DONE.includes(r.status)).map(toCard)
  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials }} hotline={s.general.hospitalPhone}>
      <Greeting name={patient.name.split(' ')[0]} />
      <div className="mt-2 grid gap-4 md:grid-cols-[1fr_320px] md:items-start">
        <div className="flex flex-col gap-6">
          <NewRequestCta />
          <section>
            <SectionTitle k="current" count={current.length} />
            <RequestList items={current} emptyKey="noCurrent" />
          </section>
          <section>
            <SectionTitle k="past" count={past.length} />
            <RequestList items={past.slice(0, 10)} emptyKey="noPast" />
          </section>
        </div>
        <div className="flex flex-col gap-4">
          <HelpBar hotline={s.general.hospitalPhone} />
        </div>
      </div>
    </PortalShell>
  )
}
