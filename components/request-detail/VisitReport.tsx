// E2 Visit report sheet (A4). Pure render: data is loaded by app/print/report/[id]/page.tsx.
import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ROLE_LABEL, TRANSPORT_MODE_LABEL, PAYMENT_METHOD_LABEL, type Role } from '@/lib/constants'
import { date, day, dayNum, dur, initialsOf, isoDay, minutesBetween, phone, taka, time } from '@/lib/format'
import { btnClass } from '@/components/ui'
import { GENDER, vitalRows } from './lib'
import { PrintButton } from './PrintButton'

const H = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`text-[11px] font-bold uppercase tracking-[.08em] text-primary-700 ${className}`}>{children}</div>

export type VisitReportProps = {
  r: any
  patient: any
  labs: any[]
  settings: { general: { hospitalName: string; department: string } }
  names: Record<string, string>
  signatureId: string | null
  auditId: string | null
  backHref: string
}

export function VisitReport({ r, patient, labs, settings, names, signatureId, auditId, backHref }: VisitReportProps) {
  const nameOf = (x: unknown) => (x ? names[String(x)] : undefined)
  const sig = signatureId ? { _id: signatureId } : null
  const lastAudit = auditId ? { _id: auditId } : null
  const id = String(r._id)
  const v = r.visit ?? {}
  const t = r.timeline ?? {}
  const list: any[] = v.checklist ?? []

  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const s = r.scheduledAt
  const slotRange = r.slot && /^\d\d–\d\d$/.test(r.slot) ? r.slot.replace(/^(\d\d)–(\d\d)$/, '$1:00 – $2:00') : s ? `${time(s)} – ${time(new Date(new Date(s).getTime() + (r.expectedDurationMin ?? 45) * 60_000))}` : ''
  const late = minutesBetween(s, t.checkInAt)
  const vit = vitalRows(v.vitals)
  const done = list.filter((c) => c.done).length
  const generated = v.reportAt ?? new Date()
  const notes = [v.notes?.clinical, v.notes?.nursing, v.remarks].filter(Boolean)
  const b = r.billing ?? {}
  const p = patient ?? {}
  const staffName = r.primaryStaff ? `${r.primaryStaff.name} (${r.primaryStaff.employeeId})` : '—'
  const coordinator = nameOf(b.reconciledBy) ?? nameOf(r.assignment?.assignedBy)

  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <style>{`@page { size: A4; margin: 0 } @media print { html, body { background: #fff } .sheet { box-shadow: none !important; margin: 0 !important } }`}</style>
      <div className="no-print mx-auto mb-4 flex w-[210mm] max-w-full items-center gap-3 px-2">
        <Link href={backHref} className={btnClass('o')}>
          <ArrowLeft size={16} /> Back
        </Link>
        <div className="flex-1 text-[13px] text-slate-500">
          {r.requestNo} · {r.status === 'COMPLETED' || r.status === 'CLOSED' ? 'final report' : 'draft · visit not completed yet'}
        </div>
        <PrintButton />
      </div>

      <div className="sheet mx-auto flex min-h-[297mm] w-[210mm] max-w-full flex-col bg-white px-[14mm] py-[13mm] text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.08),0_0_0_1px_rgba(0,0,0,.06)]">
        {/* header */}
        <div className="flex items-start justify-between">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="Unico Hospitals" className="h-10" />
          <div className="text-right">
            <div className="text-[18px] font-bold text-navy">Home Care Visit Report</div>
            <div className="text-[12px] text-slate-500">
              {settings.general.department.replace(' · Home Care', '')} Department · {settings.general.hospitalName}, Dhaka
            </div>
            <div className="text-[12px] text-slate-500">
              Report no. {r.requestNo} · generated {date(generated)} {time(generated)}
            </div>
          </div>
        </div>
        <div className="mb-5 mt-[18px] h-[3px]" style={{ background: 'linear-gradient(90deg,#0090CA 0 60%,#3AB5A7 60%)' }} />

        {/* patient / visit */}
        <div className="grid grid-cols-2 gap-5">
          <div>
            <H>Patient</H>
            <div className="mt-1 text-[16px] font-bold">{p.name ?? r.patientSnapshot?.name}</div>
            <div className="text-[12px] leading-[18px] text-slate-700">
              {[p.ageYears ?? r.patientSnapshot?.ageYears, GENDER[p.gender ?? r.patientSnapshot?.gender], (p.uhid ?? r.patientSnapshot?.uhid) && `UHID ${p.uhid ?? r.patientSnapshot?.uhid}`, p.bloodGroup].filter((x) => x != null && x !== '').join(' · ')}
              <br />
              {p.address?.full ? [p.address.full, p.address.area].filter(Boolean).join(', ') : r.patientSnapshot?.address}
              <br />
              {phone(p.phone ?? r.patientSnapshot?.phone)}
              {p.guardian?.name && ` · Guardian: ${p.guardian.name}${p.guardian.relation ? ` (${p.guardian.relation})` : ''}`}
              {(p.allergies ?? []).length > 0 && (
                <>
                  <br />
                  <span className="font-semibold text-[#B91C1C]">Allergies: {p.allergies.join(', ')}</span>
                </>
              )}
            </div>
          </div>
          <div>
            <H>Visit</H>
            <div className="mt-1 text-[16px] font-bold">{s ? `${day(s)} ${isoDay(s).slice(0, 4)} · ${slotRange}` : 'Not scheduled'}</div>
            <div className="text-[12px] leading-[18px] text-slate-700">
              {(r.services ?? []).map((x: any) => x.name).join(' · ')}
              <br />
              {team.length ? team.map((m: any) => `${m.name} (${ROLE_LABEL[m.role as Role] ?? m.role}, ${m.employeeId})`).join(' · ') : 'No team assigned'}
              {r.transport?.mode && (
                <>
                  <br />
                  Transport: {[TRANSPORT_MODE_LABEL[r.transport.mode as 'UNICO_CAR'], r.vehicle?.name, r.driver?.name].filter(Boolean).join(' · ')}
                </>
              )}
            </div>
          </div>
        </div>

        {/* stamps */}
        <div className="my-[18px] grid grid-cols-5 gap-2">
          {(
            [
              ['Requested', t.requestedAt ? `${dayNum(t.requestedAt)} ${time(t.requestedAt)}` : '—'],
              ['Confirmed', t.confirmedAt ? `${dayNum(t.confirmedAt)} ${time(t.confirmedAt)}` : '—'],
              ['Check-in', t.checkInAt ? `${time(t.checkInAt)}${late != null && late !== 0 ? ` (${late > 0 ? '+' : ''}${late})` : ''}` : '—'],
              ['Check-out', time(t.checkOutAt)],
              ['Duration', dur(v.durationMin)],
            ] as const
          ).map(([l, val]) => (
            <div key={l} className="rounded-lg border border-slate-200 px-2.5 py-2">
              <div className="text-[10px] font-semibold uppercase tracking-[.05em] text-slate-500">{l}</div>
              <div className="mt-0.5 text-[13px] font-bold">{val}</div>
            </div>
          ))}
        </div>

        {/* checklist + vitals */}
        <div className="grid grid-cols-[1.1fr_1fr] gap-5">
          <div>
            <H className="mb-1.5">
              Checklist · {done} / {list.length}
            </H>
            {list.length === 0 ? (
              <div className="text-[12px] text-slate-500">No checklist</div>
            ) : (
              <table className="w-full border-collapse text-[12px]">
                <tbody>
                  {list.map((c) => (
                    <tr key={c.key} className="border-t border-slate-100">
                      <td className={`w-4 py-[5px] ${c.done ? 'text-[#15803D]' : 'text-slate-300'}`}>{c.done ? '✓' : '○'}</td>
                      <td className={`py-[5px] ${c.done ? '' : 'text-slate-500'}`}>
                        {c.label}
                        {c.mandatory && <span className="text-[#DC2626]"> *</span>}
                        {c.note && <span className="text-slate-500"> — {c.note}</span>}
                      </td>
                      <td className="whitespace-nowrap py-[5px] text-right text-slate-500">{c.done ? `${time(c.doneAt)} · ${initialsOf(nameOf(c.doneBy))}` : 'not done'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div>
            <H className="mb-1.5">Vitals{v.vitals?.recordedAt ? ` · ${time(v.vitals.recordedAt)}` : ''}</H>
            {vit.length === 0 ? (
              <div className="text-[12px] text-slate-500">Not recorded</div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {vit.map((x) => (
                  <div key={x.key} className={`rounded-lg border px-2 py-1.5 ${x.abnormal ? 'border-[#F59E0B]' : 'border-slate-200'}`}>
                    <div className="text-[10px] text-slate-500">{x.label}</div>
                    <div className={`text-[14px] font-bold ${x.abnormal ? 'text-[#B45309]' : ''}`}>
                      {x.value} <span className="text-[10px] font-medium text-slate-500">{x.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {v.vitals?.flagged && <div className="mt-1.5 text-[11px] text-[#B45309]">Flagged to coordinator and on-call doctor at {time(v.vitals.recordedAt)}.</div>}
            {(r.tests ?? []).length > 0 && (
              <>
                <H className="mb-1.5 mt-3.5">Samples / procedures</H>
                <div className="text-[12px] leading-[18px]">
                  {r.tests.join(' · ')}
                  {labs.length > 0 && (
                    <>
                      <br />
                      <span className="text-slate-500">
                        {labs.map((l) => (l.status === 'RESULTED' ? `${l.test}: ${l.value ?? ''} ${l.unit ?? ''}${l.flag && l.flag !== 'NORMAL' ? ` (${l.flag})` : ''}` : `${l.test} pending${l.eta ? ` · ETA ${day(l.eta)} ${time(l.eta)}` : ''}`)).join(' · ')}
                      </span>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* medications */}
        {(v.medications ?? []).length > 0 && (
          <div className="mt-4">
            <H className="mb-1.5">Medication administered</H>
            <table className="w-full border-collapse text-[12px]">
              <tbody>
                {v.medications.map((m: any, i: number) => (
                  <tr key={i} className="border-t border-slate-100">
                    <td className="py-[5px] font-semibold">{m.drug}</td>
                    <td className="py-[5px]">{m.dose}</td>
                    <td className="py-[5px]">{m.route}</td>
                    <td className="py-[5px] text-right text-slate-500">
                      {m.time || time(m.at)} · {initialsOf(nameOf(m.by))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(v.consumables ?? []).length > 0 && <div className="mt-1 text-[12px] text-slate-500">Consumables: {v.consumables.map((c: any) => `${c.item} × ${c.qty}`).join(' · ')}</div>}
          </div>
        )}

        {/* notes */}
        <div className="mt-4">
          <H className="mb-1.5">Clinical &amp; nursing notes</H>
          <div className="whitespace-pre-line text-[12px] leading-[18px] text-slate-700">{notes.length ? notes.join('\n') : 'No notes recorded.'}</div>
        </div>

        {/* billing */}
        <div className="mt-4 grid grid-cols-4 gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px]">
          <div>
            <span className="text-slate-500">Bill</span> <b>{taka(b.billAmount ?? b.estimatedFee)}</b>
          </div>
          <div>
            <span className="text-slate-500">Payment</span> <b>{[b.status, b.method && PAYMENT_METHOD_LABEL[b.method as 'CASH']].filter(Boolean).join(' · ') || '—'}</b>
          </div>
          <div>
            <span className="text-slate-500">Invoice</span> <b>{b.invoiceNo || '—'}</b>
          </div>
          <div className="text-right">
            <span className="text-slate-500">Invoice total</span> <b>{taka(b.invoiceAmount)}</b>
          </div>
        </div>

        {/* signatures */}
        <div className="mt-auto grid grid-cols-3 gap-4 border-t border-slate-200 pt-3.5 text-[11px] text-slate-500">
          <div>
            <div className="relative mb-1 h-[34px] border-b border-slate-300">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {sig && <img src={`/api/v1/attachments/${sig._id}`} alt="Signature" className="absolute bottom-0 left-0 h-[40px] object-contain" />}
            </div>
            Patient / relative
            {v.confirmation?.type
              ? ` · ${[v.confirmation.name, v.confirmation.relation && `(${v.confirmation.relation})`].filter(Boolean).join(' ') || 'patient'} · ${v.confirmation.type === 'PAD' ? 'signed' : v.confirmation.type === 'OTP' ? 'OTP confirmed' : 'confirmed verbally'} ${time(v.confirmation.at)}`
              : ' · not confirmed'}
          </div>
          <div>
            <div className="mb-1 h-[34px] border-b border-slate-300" />
            Visiting staff · {staffName}
          </div>
          <div>
            <div className="mb-1 h-[34px] border-b border-slate-300" />
            Verified by coordinator · {r.status === 'CLOSED' ? coordinator ?? '—' : 'pending'}
          </div>
        </div>
        <div className="mt-2.5 flex justify-between text-[10px] text-slate-400">
          <span>Confidential medical record · retained 7 years{lastAudit ? ` · audit id ${String(lastAudit._id).slice(0, 4)}…${String(lastAudit._id).slice(-3)}` : ''}</span>
          <span>Unico HomeCare · {r.requestNo}</span>
        </div>
      </div>
    </div>
  )
}
