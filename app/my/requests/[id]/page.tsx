import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft } from 'lucide-react'
import { requirePatient } from '@/lib/patient-auth'
import { getSettings } from '@/lib/settings'
import { patientRequest } from '@/lib/services/patients-portal'
import { isOid } from '@/lib/models'
import { ROLE_LABEL, type Role } from '@/lib/constants'
import { dateTime, relDay, time } from '@/lib/format'
import { lifecycleSteps } from '@/components/request-detail/lib'
import { MapEmbed } from '@/components/ui'
import { PortalShell } from '@/components/patient/PortalShell'
import { HelpBar, SectionTitle, StatusPill, Timeline, type TimelineStep } from '@/components/patient/RequestCards'

export const metadata: Metadata = { title: 'Visit progress' }

/** One request for the patient: status, time, care team, progress timeline. */
export default async function MyRequest({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const patient = await requirePatient(`/my/requests/${id}`)
  if (!isOid(id)) notFound()
  const [s, r] = await Promise.all([getSettings(), patientRequest(patient, id)])
  if (!r) notFound()
  const steps: TimelineStep[] = lifecycleSteps(r, s.sla)
    .filter((st) => st.key !== 'verified' && st.key !== 'closed')
    .map((st) => ({ key: st.key, at: st.at ? dateTime(st.at) : undefined, sub: st.state === 'current' ? undefined : st.sub, state: st.state }))
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const when = r.scheduledAt ? `${relDay(r.scheduledAt)} · ${time(r.scheduledAt)}` : r.preferred?.date ? `${relDay(r.preferred.date)}${r.preferred.slot ? ` · ${r.preferred.slot}` : ''}` : '—'

  return (
    <PortalShell patient={{ name: patient.name, initials: patient.initials }} hotline={s.general.hospitalPhone}>
      <Link href="/my" className="inline-flex h-10 items-center gap-1 text-[14px] font-semibold text-slate-600">
        <ChevronLeft size={18} /> {patient.name.split(' ')[0]}
      </Link>
      <div className="mt-1 grid gap-4 md:grid-cols-[1fr_320px] md:items-start">
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl p-4 hc-soft sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill status={r.status} big />
              <span className="font-mono text-[13px] text-slate-400">{r.requestNo}</span>
            </div>
            <h1 className="mt-3 text-[22px] font-bold leading-tight">{(r.services ?? []).map((x: any) => x.name).join(', ')}</h1>
            <div className="mt-1 text-[15px] text-slate-600">{when}</div>
            {r.patientSnapshot?.address && <div className="mt-2 text-[13.5px] text-slate-500">{r.patientSnapshot.address}</div>}
            {r.status === 'CANCELLED' && r.cancellation?.reason && <div className="mt-3 rounded-lg bg-[#FEE2E2] px-3 py-2 text-[13.5px] text-[#B91C1C]">{r.cancellation.reason}</div>}
          </section>

          <section className="rounded-2xl p-4 hc-soft sm:p-5">
            <SectionTitle k="team" />
            {team.length ? (
              <ul className="flex flex-col gap-2">
                {team.map((m: any) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-teal text-[13px] font-bold text-white">
                      {m.name
                        .replace(/^(Dr\.?|Md\.?)\s+/i, '')
                        .split(/\s+/)
                        .slice(0, 2)
                        .map((p: string) => p[0])
                        .join('')
                        .toUpperCase()}
                    </span>
                    <span>
                      <span className="block text-[15px] font-semibold">{m.name}</span>
                      <span className="block text-[12.5px] text-slate-500">{ROLE_LABEL[m.role as Role] ?? m.role}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-[14px] text-slate-500">—</div>
            )}
          </section>

          <section className="rounded-2xl p-4 hc-soft sm:p-5">
            <SectionTitle k="timeline" />
            <Timeline steps={steps} />
          </section>
        </div>
        <div className="flex flex-col gap-4">
          <HelpBar hotline={s.general.hospitalPhone} />
          <MapEmbed height={200} address={r.patientSnapshot?.address} className="rounded-2xl" />
        </div>
      </div>
    </PortalShell>
  )
}
