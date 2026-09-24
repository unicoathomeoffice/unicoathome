// Server-rendered tabs of the request detail (W04): Overview · Timeline · Assignment · Visit data · Messages · Attachments · Audit.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Bell, Car, FileText, Mail, MessageCircle, MessageSquare, Paperclip, ScrollText, Smartphone, UserX, Wallet } from 'lucide-react'
import { ActionButton } from '@/components/client'
import { Avatar, Empty, StatusChip, Tag, type Tone } from '@/components/ui'
import { PAYMENT_METHOD_LABEL, ROLE_LABEL, TRANSPORT_MODE_LABEL, type Role } from '@/lib/constants'
import { ago, cx, date, dateTime, dayNum, dur, minutesBetween, phone, taka, time } from '@/lib/format'
import { Field, MetricsTable, Panel, Stepper, SubTitle, VitalTiles } from './ui'
import { bytes, GENDER, lifecycleSteps, timingMetrics, vitalRows, who, whoInitials, type People, type Sla } from './lib'
import { Expander, EmailPreview, ResendButton, AttachmentUploader, DeleteAttachment } from './widgets'
import { PettyTag } from './actions'

const card = 'min-w-0 rounded-card bg-white shadow-card'

// ================================================================ Overview
export function OverviewTab({
  r,
  patient,
  people,
  sla,
  edit,
  photoCount,
  staffWhatsAppAt,
  historyCount,
}: {
  r: any
  patient: any
  people: People
  sla: Sla
  edit?: ReactNode
  photoCount: number
  staffWhatsAppAt: string | null
  historyCount: number
}) {
  const t = r.timeline ?? {}
  const p = patient ?? {}
  const late = minutesBetween(r.scheduledAt, t.checkInAt)
  const vit = vitalRows(r.visit?.vitals)
  const list = r.visit?.checklist ?? []
  const ticked = list.filter((c: any) => c.done && c.doneAt).sort((a: any, b: any) => String(b.doneAt).localeCompare(String(a.doneAt)))
  const lastMed = (r.visit?.medications ?? []).at(-1)
  const primary = r.primaryStaff
  const hasVisit = !!t.checkInAt
  return (
    <div className="flex flex-col gap-4">
      <Stepper steps={lifecycleSteps(r, sla)} />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_1fr_1fr]">
        {/* Patient */}
        <Panel
          title="Patient"
          right={
            r.patientId && (
              <Link href={`/patients/${r.patientId}`} className="text-[13px] font-semibold text-primary-700 hover:underline">
                Open profile
              </Link>
            )
          }
        >
          <div className="flex items-center gap-3.5">
            <Avatar name={r.patientSnapshot?.name} size={52} />
            <div className="min-w-0">
              <div className="truncate text-[18px] font-bold">{p.name ?? r.patientSnapshot?.name}</div>
              <div className="text-[13px] text-slate-500">
                {[p.ageYears ?? r.patientSnapshot?.ageYears, GENDER[p.gender ?? r.patientSnapshot?.gender], (p.uhid ?? r.patientSnapshot?.uhid) && `MRN ${p.uhid ?? r.patientSnapshot?.uhid}`, p.bloodGroup].filter((x) => x != null && x !== '').join(' · ')}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Field k="Phone">
              {phone(p.phone ?? r.patientSnapshot?.phone)}
              {p.altPhone && <div className="text-slate-500">{phone(p.altPhone)}</div>}
            </Field>
            <Field k="Requester">
              {r.requester?.type === 'SELF' || !r.requester?.name
                ? r.requester?.type === 'STAFF'
                  ? 'Staff'
                  : 'Self'
                : `${r.requester.name}${r.requester.relation ? ` (${r.requester.relation})` : ''}${r.requester.phone ? ` · ${phone(r.requester.phone)}` : ''}`}
            </Field>
            <Field k="Address">{p.address?.full ? [p.address.full, p.address.area].filter(Boolean).join(', ') : r.patientSnapshot?.address || '—'}</Field>
            <Field k="Landmark">{p.address?.landmark || '—'}</Field>
            <Field k="Allergies">
              {(r.clinical?.allergies?.length ? r.clinical.allergies : p.allergies)?.length ? <span className="font-bold text-[#B91C1C]">{(r.clinical?.allergies?.length ? r.clinical.allergies : p.allergies).join(', ')}</span> : 'None known'}
            </Field>
            <Field k="Consent">
              WhatsApp {p.consent?.whatsapp === false ? '✕' : '✓'} · Email {p.consent?.email === false ? '✕' : '✓'}
              {p.consent?.at && ` (${time(p.consent.at)})`}
            </Field>
            {p.guardian?.name && (
              <Field k="Guardian" className="col-span-2">
                {p.guardian.name}
                {p.guardian.relation && ` (${p.guardian.relation})`}
                {p.guardian.phone && ` · ${phone(p.guardian.phone)}`}
              </Field>
            )}
          </div>
          <div className="mt-4 border-t border-slate-100 pt-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500">Chief complaint</div>
            <div className="mt-1 text-[13px] leading-[19px] text-slate-700">
              {r.clinical?.complaint || '—'}
              {r.clinical?.referringDoctor && ` Referred by ${r.clinical.referringDoctor}.`}
            </div>
            {r.clinical?.notes && <div className="mt-1.5 text-[13px] leading-[19px] text-slate-500">{r.clinical.notes}</div>}
          </div>
        </Panel>

        {/* Service & schedule + timing metrics */}
        <Panel title="Service & schedule" right={edit}>
          <div className="grid grid-cols-2 gap-3">
            <Field k="Service">{(r.services ?? []).map((s: any) => s.name).join(', ') || '—'}</Field>
            <Field k="Planned duration">{dur(r.expectedDurationMin ?? 45)}</Field>
            <Field k="Scheduled">
              {r.scheduledAt ? `${dateTime(r.scheduledAt)}${r.slot ? ` (slot ${r.slot})` : ''}` : r.preferred?.date ? `Preferred ${r.preferred.date}${r.preferred.slot ? ` · ${r.preferred.slot}` : ''}` : 'Not set'}
            </Field>
            <Field k="Checked in">{t.checkInAt ? `${time(t.checkInAt)} · ${late != null && late > 0 ? `+${late} min` : 'on time'}` : '—'}</Field>
            <Field k="Fee">
              {[
                taka(r.billing?.billAmount ?? r.billing?.estimatedFee),
                r.billing?.method && PAYMENT_METHOD_LABEL[r.billing.method as 'CASH'],
                r.billing?.status === 'PAID' ? 'paid' : r.billing?.status === 'DUE' ? 'due' : r.billing?.status === 'WAIVED' ? 'waived' : 'pending',
              ]
                .filter(Boolean)
                .join(' · ')}
            </Field>
            <Field k="Source">
              {[r.source ? r.source.charAt(0) + r.source.slice(1).toLowerCase().replace('_', '-') : null, r.createdByUser ? ROLE_LABEL[r.createdByUser.role as Role] ?? r.createdByUser.name : null].filter(Boolean).join(' · ')}
            </Field>
            {r.tests?.length > 0 && (
              <Field k="Tests / procedures" className="col-span-2">
                {r.tests.join(' · ')}
              </Field>
            )}
            {r.transport?.needed && (
              <Field k="Transport" className="col-span-2">
                {r.transport.mode ? TRANSPORT_MODE_LABEL[r.transport.mode as 'UNICO_CAR'] : 'Requested'}
                {r.vehicle && ` · ${r.vehicle.name} ${r.vehicle.plate}`}
                {r.driver && ` · ${r.driver.name}`}
              </Field>
            )}
          </div>
          <div className="mt-5 text-[15px] font-bold">Timing metrics</div>
          <MetricsTable rows={timingMetrics(r, sla)} className="mt-2.5" />
        </Panel>

        {/* Assignment + live visit data */}
        <Panel
          title="Assignment"
          right={
            <Link href="?tab=assignment" scroll={false} className="text-[13px] font-semibold text-primary-700 hover:underline">
              History · {historyCount}
            </Link>
          }
        >
          {primary ? (
            <>
              <div className="flex items-center gap-3 rounded-[10px] bg-slate-50 p-3">
                <Avatar name={primary.name} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-bold">{primary.name}</div>
                  <div className="text-[12px] text-slate-500">{[primary.designation ?? ROLE_LABEL[primary.role as Role], primary.employeeId, phone(primary.phone)].filter(Boolean).join(' · ')}</div>
                </div>
                <StatusChip status={t.acceptedAt || r.assignment?.acceptedAt ? 'ACCEPTED' : 'ASSIGNED'} sm label={t.acceptedAt || r.assignment?.acceptedAt ? 'ACCEPTED' : 'AWAITING'} />
              </div>
              <div className="mt-3.5 grid grid-cols-2 gap-3">
                <Field k="Assigned by">{r.assignment?.assignedBy ? `${who(people, r.assignment.assignedBy)} · ${time(r.assignment.assignedAt ?? t.assignedAt)}` : '—'}</Field>
                <Field k="Accepted">
                  {r.assignment?.acceptedAt ?? t.acceptedAt
                    ? `${time(r.assignment?.acceptedAt ?? t.acceptedAt)} (${dur(minutesBetween(t.assignedAt, r.assignment?.acceptedAt ?? t.acceptedAt))})`
                    : r.assignment?.respondBy
                      ? `Respond by ${time(r.assignment.respondBy)}`
                      : '—'}
                </Field>
                <Field k="Secondary">{r.secondaryStaff?.length ? r.secondaryStaff.map((s: any) => s.name).join(', ') : '—'}</Field>
                <Field k="Notify">Push ✓{staffWhatsAppAt ? ` · WhatsApp ✓ ${time(staffWhatsAppAt)}` : ' · WhatsApp —'}</Field>
              </div>
            </>
          ) : (
            <div className="rounded-[10px] border border-dashed border-slate-300 px-4 py-6 text-center">
              <UserX size={22} className="mx-auto text-slate-400" />
              <div className="mt-1.5 text-[14px] font-bold">Not assigned yet</div>
              <div className="text-[12.5px] text-slate-500">
                {r.status === 'CONFIRMED' ? 'Use Assign to pick the care team.' : ['NEW', 'VERIFIED'].includes(r.status) ? 'Confirm the request first, then assign.' : 'No care team on this request.'}
              </div>
            </div>
          )}
          {r.assignment?.instructions && (
            <div className="mt-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-[.05em] text-slate-500">Instructions</div>
              <div className="mt-1 text-[13px] leading-[19px] text-slate-700">{r.assignment.instructions}</div>
            </div>
          )}
          <div className="mt-5 text-[15px] font-bold">Live visit data</div>
          {hasVisit ? (
            <div className="mt-2.5 flex flex-col gap-2 text-[13px]">
              <div className="flex gap-3">
                <div className="w-[110px] flex-none text-slate-500">Vitals{r.visit?.vitals?.recordedAt ? ` · ${time(r.visit.vitals.recordedAt)}` : ''}</div>
                <div className="flex-1">
                  {vit.length
                    ? vit.filter((v) => v.key !== 'weightKg' && v.key !== 'painScore').map((v, i) => (
                        <span key={v.key}>
                          {i > 0 && ' · '}
                          {v.key === 'bp' ? 'BP' : v.key === 'pulse' ? 'P' : v.key === 'tempC' ? 'T' : v.label}{' '}
                          {v.abnormal ? <b className="text-[#B45309]">{v.value}</b> : v.value}
                        </span>
                      ))
                    : 'Not recorded'}
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-[110px] flex-none text-slate-500">Checklist</div>
                <div className="flex-1">
                  {list.filter((c: any) => c.done).length} / {list.length}
                  {ticked[0] && ` · last tick ${time(ticked[0].doneAt)} ${ticked[0].label}`}
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-[110px] flex-none text-slate-500">Medication</div>
                <div className="flex-1">{lastMed ? [lastMed.drug, lastMed.dose, lastMed.route, lastMed.time].filter(Boolean).join(' · ') : '—'}</div>
              </div>
              <div className="flex gap-3">
                <div className="w-[110px] flex-none text-slate-500">Photos</div>
                <div className="flex-1">{photoCount ? `${photoCount} uploaded` : 'None yet'}</div>
              </div>
              {t.checkOutAt && (
                <div className="flex gap-3">
                  <div className="w-[110px] flex-none text-slate-500">Check-out</div>
                  <div className="flex-1">
                    {time(t.checkOutAt)} · {dur(r.visit?.durationMin)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-2 text-[13px] text-slate-500">Vitals, checklist ticks, medication and photos appear here live once the team checks in.</div>
          )}
        </Panel>
      </div>
    </div>
  )
}

// ================================================================ Timeline
type Ev = { at: string; label: ReactNode; sub?: ReactNode; tone?: 'g' | 'b' | 'a' | 'r' | 's'; by?: string }
const TONE_DOT = { g: 'bg-[#16A34A]', b: 'bg-primary', a: 'bg-[#F59E0B]', r: 'bg-[#DC2626]', s: 'bg-slate-400' }

export function TimelineTab({ r, people, sla }: { r: any; people: People; sla: Sla }) {
  const t = r.timeline ?? {}
  const ev: Ev[] = []
  const push = (at: any, e: Omit<Ev, 'at'>) => at && ev.push({ at: new Date(at).toISOString(), ...e })
  push(t.requestedAt, { label: 'Request created', sub: `${r.source ?? ''} · by ${who(people, r.createdBy)}`, tone: 'b' })
  push(t.verifiedAt, { label: 'Verified', tone: 'b' })
  push(t.confirmedAt, { label: 'Confirmed', sub: r.scheduledAt ? `Visit ${dateTime(r.scheduledAt)}` : undefined, tone: 'b' })
  push(t.assignedAt, { label: `Assigned to ${r.primaryStaff?.name ?? 'staff'}`, sub: r.assignment?.assignedBy ? `by ${who(people, r.assignment.assignedBy)}` : undefined, tone: 'b' })
  for (const d of r.assignment?.declines ?? []) push(d.at, { label: `Declined by ${who(people, d.staffId)}`, sub: [d.reason, d.note].filter(Boolean).join(' · '), tone: 'r' })
  push(t.acceptedAt, { label: 'Accepted', sub: r.primaryStaff?.name, tone: 'g' })
  push(t.enRouteAt, { label: 'Started journey', tone: 'b' })
  push(t.checkInAt, {
    label: 'Checked in',
    sub: [
      (() => {
        const l = minutesBetween(r.scheduledAt, t.checkInAt)
        return l == null ? null : l > sla.lateAfterMin ? `${l} min late` : l > 0 ? `+${l} min` : 'on time'
      })(),
      r.visit?.checkIn?.lat != null ? `GPS ${r.visit.checkIn.lat.toFixed(4)}, ${r.visit.checkIn.lng.toFixed(4)}${r.visit.checkIn.accuracyM ? ` ±${Math.round(r.visit.checkIn.accuracyM)} m` : ''}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    tone: 'g',
  })
  for (const c of r.visit?.checklist ?? []) if (c.done && c.doneAt) push(c.doneAt, { label: `Ticked · ${c.label}`, sub: [who(people, c.doneBy), c.note].filter(Boolean).join(' · '), tone: 's' })
  if (r.visit?.vitals?.recordedAt)
    push(r.visit.vitals.recordedAt, {
      label: r.visit.vitals.abnormal?.length ? 'Vitals recorded · abnormal' : 'Vitals recorded',
      sub: vitalRows(r.visit.vitals)
        .map((v) => `${v.label} ${v.value}`)
        .join(' · '),
      tone: r.visit.vitals.abnormal?.length ? 'a' : 's',
    })
  for (const m of r.visit?.medications ?? []) push(m.at, { label: `Medication · ${m.drug}`, sub: [m.dose, m.route, who(people, m.by)].filter(Boolean).join(' · '), tone: 's' })
  if (r.visit?.confirmation?.at) push(r.visit.confirmation.at, { label: `Patient confirmation · ${r.visit.confirmation.type}`, sub: [r.visit.confirmation.name, r.visit.confirmation.relation].filter(Boolean).join(' · '), tone: 's' })
  for (const p of r.pettyCash ?? []) {
    push(p.requestedAt, { label: `Petty cash requested · ${taka(p.amount)}`, sub: `${p.purpose} · ${who(people, p.requestedBy)}`, tone: 'a' })
    if (p.decidedAt) push(p.decidedAt, { label: `Petty cash ${p.status.toLowerCase()}`, sub: who(people, p.decidedBy), tone: p.status === 'APPROVED' ? 'g' : 'r' })
  }
  for (const l of r.transport?.legs ?? []) if (l.at) push(l.at, { label: `Trip · ${l.label}`, sub: r.driver?.name, tone: 's' })
  push(t.checkOutAt, { label: 'Checked out', sub: `Duration ${dur(r.visit?.durationMin)}${r.visit?.overtimeMin ? ` · overtime ${r.visit.overtimeMin} min` : ''}`, tone: 'g' })
  push(t.completedAt, { label: 'Visit completed · report generated', tone: 'g' })
  push(t.closedAt, { label: 'Closed', sub: r.billing?.invoiceNo ? `Invoice ${r.billing.invoiceNo} · ${taka(r.billing.invoiceAmount)}` : undefined, tone: 'g' })
  for (const x of r.reschedules ?? []) push(x.at, { label: 'Rescheduled', sub: `${x.from ? dateTime(x.from) : '—'} → ${dateTime(x.to)}${x.reason ? ` · ${x.reason}` : ''} · by ${who(people, x.by)}`, tone: 'a' })
  push(t.cancelledAt ?? r.cancellation?.at, { label: 'Cancelled', sub: [r.cancellation?.reason, r.cancellation?.by && `by ${who(people, r.cancellation.by)}`].filter(Boolean).join(' · '), tone: 'r' })
  ev.sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div className="grid gap-5 xl:grid-cols-[1.3fr_1fr]">
      <section className={cx(card, 'p-5')}>
        <div className="text-[15px] font-bold">Timeline</div>
        <div className="mt-0.5 text-[13px] text-slate-500">Every server time stamp, in Dhaka time</div>
        {ev.length === 0 ? (
          <Empty title="No events yet" />
        ) : (
          <ol className="mt-4">
            {ev.map((e, i) => (
              <li key={i} className="flex gap-3">
                <div className="w-[118px] flex-none pt-px text-right text-[12.5px] text-slate-500">
                  <div className="font-semibold text-slate-700">{time(e.at)}</div>
                  <div className="text-[11.5px]">{dayNum(e.at)}</div>
                </div>
                <div className="flex flex-none flex-col items-center">
                  <div className={cx('mt-1 size-2.5 rounded-full', TONE_DOT[e.tone ?? 's'])} />
                  {i < ev.length - 1 && <div className="w-0.5 flex-1 bg-slate-200" />}
                </div>
                <div className="min-w-0 flex-1 pb-4">
                  <div className="text-[13.5px] font-semibold">{e.label}</div>
                  {e.sub && <div className="text-[12.5px] text-slate-500">{e.sub}</div>}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
      <div className="flex min-w-0 flex-col gap-5">
        <section className={cx(card, 'p-5')}>
          <div className="text-[15px] font-bold">Timing metrics</div>
          <div className="mt-0.5 text-[13px] text-slate-500">Targets from Settings · SLA</div>
          <MetricsTable rows={timingMetrics(r, sla, true)} className="mt-3" />
        </section>
        <section className={cx(card, 'p-5')}>
          <div className="text-[15px] font-bold">Device stamps</div>
          <div className="mt-0.5 text-[13px] text-slate-500">Phone time vs server time for field actions (offline-safe)</div>
          {(r.deviceStamps ?? []).length === 0 ? (
            <div className="mt-3 text-[13px] text-slate-400">No device stamps recorded</div>
          ) : (
            <div className="mt-3 flex flex-col">
              {r.deviceStamps.map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-3 border-t border-slate-100 py-2 text-[13px] first:border-t-0">
                  <div className="w-[96px] flex-none font-semibold capitalize">{String(d.event).replace('_', ' ')}</div>
                  <div className="flex-1 text-slate-600">
                    device {dateTime(d.deviceAt)} · {who(people, d.by)}
                  </div>
                  {d.offline ? <Tag tone="amber">offline</Tag> : <Tag tone="green">online</Tag>}
                </div>
              ))}
            </div>
          )}
        </section>
        <section className={cx(card, 'p-5')}>
          <div className="text-[15px] font-bold">Reschedule history</div>
          {(r.reschedules ?? []).length === 0 ? (
            <div className="mt-3 text-[13px] text-slate-400">Never rescheduled</div>
          ) : (
            <div className="mt-3 flex flex-col">
              {r.reschedules.map((x: any, i: number) => (
                <div key={i} className="border-t border-slate-100 py-2 text-[13px] first:border-t-0">
                  <div className="font-semibold">
                    {x.from ? dateTime(x.from) : '—'} → {dateTime(x.to)}
                    {x.slot && ` (${x.slot})`}
                  </div>
                  <div className="text-slate-500">
                    {x.reason} · {who(people, x.by)} · {dateTime(x.at)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

// ================================================================ Assignment
const LOG_TONE: Record<string, Tone> = { ASSIGN: 'violet', REASSIGN: 'indigo', ACCEPT: 'green', DECLINE: 'red', TIMEOUT: 'amber', HANDOVER: 'orange' }

export function AssignmentTab({ r, people, logs }: { r: any; people: People; logs: any[] }) {
  const team = [r.primaryStaff && { ...r.primaryStaff, primary: true }, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const declines = r.assignment?.declines ?? []
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1.4fr]">
      <div className="flex min-w-0 flex-col gap-5">
        <Panel title="Current team" right={<span className="text-[13px] text-slate-500">Care team number · {r.assignment?.teamSize ?? team.length ?? 1}</span>}>
          {team.length === 0 ? (
            <Empty icon={<UserX size={24} />} title="No care team" sub={r.status === 'CONFIRMED' ? 'This request is waiting for assignment.' : 'Nobody is assigned to this request.'} />
          ) : (
            <div className="flex flex-col gap-2">
              {team.map((s: any) => (
                <div key={s.id} className="flex items-center gap-3 rounded-[10px] bg-slate-50 p-3">
                  <Avatar name={s.name} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold">{s.name}</div>
                    <div className="truncate text-[12px] text-slate-500">{[s.designation ?? ROLE_LABEL[s.role as Role], s.employeeId, phone(s.phone)].filter(Boolean).join(' · ')}</div>
                  </div>
                  <Tag tone={s.primary ? 'blue' : 'violet'}>{s.primary ? 'Primary' : 'Secondary'}</Tag>
                </div>
              ))}
              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field k="Assigned by">{r.assignment?.assignedBy ? `${who(people, r.assignment.assignedBy)} · ${dateTime(r.assignment.assignedAt)}` : '—'}</Field>
                <Field k="Accepted">{r.assignment?.acceptedAt ? dateTime(r.assignment.acceptedAt) : r.assignment?.respondBy ? `Respond by ${time(r.assignment.respondBy)}` : '—'}</Field>
                {r.assignment?.instructions && (
                  <Field k="Instructions" className="col-span-2">
                    {r.assignment.instructions}
                  </Field>
                )}
              </div>
            </div>
          )}
        </Panel>
        <Panel title={`Declines · ${declines.length}`}>
          {declines.length === 0 ? (
            <div className="text-[13px] text-slate-400">No one has declined this visit</div>
          ) : (
            <div className="flex flex-col">
              {declines.map((d: any, i: number) => (
                <div key={i} className="flex items-start gap-3 border-t border-slate-100 py-2.5 first:border-t-0">
                  <Avatar name={who(people, d.staffId)} size={32} tone="slate" />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-semibold">{who(people, d.staffId)}</div>
                    <div className="text-slate-500">
                      <span className="font-semibold text-[#B91C1C]">{d.reason}</span>
                      {d.note && ` · ${d.note}`}
                    </div>
                  </div>
                  <div className="text-[12px] text-slate-500">{dateTime(d.at)}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
      <section className={cx(card, 'overflow-hidden')}>
        <div className="px-5 pt-5 text-[15px] font-bold">Assignment history</div>
        <div className="px-5 pb-3 text-[13px] text-slate-500">Every assign, reassign, accept, decline and timeout</div>
        <div className="grid h-11 grid-cols-[130px_100px_1fr_1fr_120px] items-center border-y border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
          <div>When</div>
          <div>Action</div>
          <div>Staff</div>
          <div>Reason / note</div>
          <div>By</div>
        </div>
        {logs.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">No assignment activity yet</div>
        ) : (
          logs.map((l) => (
            <div key={l._id} className="grid min-h-12 grid-cols-[130px_100px_1fr_1fr_120px] items-center border-t border-slate-100 px-5 py-2 text-[13px] first:border-t-0">
              <div className="text-slate-600">{dateTime(l.at)}</div>
              <div>
                <Tag tone={LOG_TONE[l.action] ?? 'slate'}>{l.action}</Tag>
              </div>
              <div className="min-w-0 pr-3">
                {l.fromStaffId && l.toStaffId ? (
                  <>
                    <span className="text-slate-500">{who(people, l.fromStaffId)}</span> → <b>{who(people, l.toStaffId)}</b>
                  </>
                ) : (
                  <b>{who(people, l.toStaffId ?? l.fromStaffId)}</b>
                )}
              </div>
              <div className="min-w-0 truncate pr-3 text-slate-600">{l.reason || '—'}</div>
              <div className="truncate text-slate-600">{who(people, l.by)}</div>
            </div>
          ))
        )}
      </section>
    </div>
  )
}

// ================================================================ Visit data
export function VisitTab({
  r,
  people,
  photos,
  signature,
  prescriptions,
  labs,
  canDecide,
  reportHref,
}: {
  r: any
  people: People
  photos: any[]
  signature: any | null
  prescriptions: any[]
  labs: any[]
  canDecide: boolean
  reportHref: string | null
}) {
  const v = r.visit ?? {}
  const list = v.checklist ?? []
  const vit = vitalRows(v.vitals)
  const b = r.billing ?? {}
  const started = !!r.timeline?.checkInAt
  const match = b.billAmount != null && b.invoiceAmount != null ? Math.round(b.billAmount) === Math.round(b.invoiceAmount) : null
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        <Panel title={`Checklist · ${list.filter((c: any) => c.done).length} / ${list.length}`} right={<span className="text-[12px] text-slate-500">* mandatory</span>}>
          {list.length === 0 ? (
            <div className="text-[13px] text-slate-400">No checklist for this service</div>
          ) : (
            <div className="flex flex-col">
              {list.map((c: any) => (
                <div key={c.key} className="flex items-start gap-3 border-t border-slate-100 py-2 text-[13px] first:border-t-0">
                  <div className={cx('mt-px flex size-5 flex-none items-center justify-center rounded-md text-[12px] font-bold', c.done ? 'bg-[#16A34A] text-white' : 'border-2 border-slate-300')}>{c.done ? '✓' : ''}</div>
                  <div className="min-w-0 flex-1">
                    <div className={cx('font-semibold', !c.done && 'text-slate-500')}>
                      {c.label}
                      {c.mandatory && <span className="text-[#DC2626]"> *</span>}
                      {c.adHoc && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[10.5px] font-bold text-slate-500">AD-HOC</span>}
                    </div>
                    {c.note && <div className="text-slate-500">{c.note}</div>}
                    {c.untickReason && !c.done && <div className="text-[#B45309]">Unticked: {c.untickReason}</div>}
                  </div>
                  <div className="whitespace-nowrap text-right text-slate-500">{c.done ? `${time(c.doneAt)} · ${whoInitials(people, c.doneBy) || '—'}` : '—'}</div>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel title={`Vitals${v.vitals?.recordedAt ? ` · ${time(v.vitals.recordedAt)}` : ''}`} right={v.vitals?.recordedBy && <span className="text-[12px] text-slate-500">by {who(people, v.vitals.recordedBy)}</span>}>
          {vit.length === 0 ? (
            <div className="text-[13px] text-slate-400">{started ? 'Not recorded yet' : 'Recorded after check-in'}</div>
          ) : (
            <>
              <VitalTiles rows={vit} cols={4} />
              {v.vitals?.flagged && <div className="mt-2 text-[12px] font-semibold text-[#B45309]">Flagged to coordinator and on-call doctor at {time(v.vitals.recordedAt)}.</div>}
            </>
          )}
        </Panel>
        <Panel title={`Medications · ${(v.medications ?? []).length}`}>
          {(v.medications ?? []).length === 0 ? (
            <div className="text-[13px] text-slate-400">No medication given</div>
          ) : (
            <div className="flex flex-col">
              {v.medications.map((m: any, i: number) => (
                <div key={m._id ?? i} className="grid grid-cols-[1.4fr_1fr_70px_110px] gap-2 border-t border-slate-100 py-2 text-[13px] first:border-t-0">
                  <div className="font-semibold">{m.drug}</div>
                  <div>{m.dose || '—'}</div>
                  <div>{m.route || '—'}</div>
                  <div className="text-right text-slate-500">
                    {m.time || time(m.at)} · {whoInitials(people, m.by)}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(v.consumables ?? []).length > 0 && (
            <>
              <SubTitle className="mt-4">Consumables</SubTitle>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {v.consumables.map((c: any, i: number) => (
                  <Tag key={i}>
                    {c.item} × {c.qty}
                  </Tag>
                ))}
              </div>
            </>
          )}
        </Panel>
        <Panel title="Notes">
          {!v.notes?.clinical && !v.notes?.nursing && !v.remarks ? (
            <div className="text-[13px] text-slate-400">No notes yet</div>
          ) : (
            <div className="flex flex-col gap-3 text-[13px] leading-[19px]">
              {v.notes?.clinical && <Field k="Clinical notes">{v.notes.clinical}</Field>}
              {v.notes?.nursing && <Field k="Nursing notes">{v.notes.nursing}</Field>}
              {v.remarks && <Field k="Remarks">{v.remarks}</Field>}
              {v.notes?.updatedAt && <div className="text-[12px] text-slate-400">Updated {dateTime(v.notes.updatedAt)}</div>}
            </div>
          )}
        </Panel>
        {(prescriptions.length > 0 || labs.length > 0) && (
          <Panel title="Prescription & lab results">
            {prescriptions.map((p) => (
              <div key={p._id} className="mb-3 rounded-lg border border-slate-200 p-3 text-[13px]">
                <div className="flex items-center justify-between">
                  <b>{p.dx || 'Prescription'}</b>
                  <Tag tone={p.status === 'SIGNED' ? 'green' : 'amber'}>{p.status}</Tag>
                </div>
                {(p.items ?? []).map((it: any, i: number) => (
                  <div key={i} className="mt-1 text-slate-700">
                    {it.drug} · {it.dose} {it.duration && `· ${it.duration}`}
                  </div>
                ))}
                {p.advice && <div className="mt-1 text-slate-500">{p.advice}</div>}
              </div>
            ))}
            {labs.map((l) => (
              <div key={l._id} className="flex items-center gap-3 border-t border-slate-100 py-2 text-[13px] first:border-t-0">
                <div className="min-w-0 flex-1 font-semibold">{l.test}</div>
                <div className={cx(l.flag && l.flag !== 'NORMAL' && 'font-bold text-[#B45309]')}>{l.status === 'RESULTED' ? `${l.value ?? ''} ${l.unit ?? ''}` : `ETA ${l.eta ? dateTime(l.eta) : '—'}`}</div>
                <Tag tone={l.status === 'RESULTED' ? (l.flag && l.flag !== 'NORMAL' ? 'amber' : 'green') : 'slate'}>{l.status === 'RESULTED' ? l.flag ?? 'RESULTED' : 'PENDING'}</Tag>
              </div>
            ))}
          </Panel>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <Panel title={`Photos · ${photos.length}`}>
          {photos.length === 0 ? (
            <div className="text-[13px] text-slate-400">No wound, dressing or sample photos</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((a) => (
                <a key={a._id} href={`/api/v1/attachments/${a._id}`} target="_blank" rel="noreferrer" className="group relative block overflow-hidden rounded-lg bg-slate-100">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/v1/attachments/${a._id}`} alt={a.caption ?? a.kind} className="aspect-square w-full object-cover" loading="lazy" />
                  <div className="absolute inset-x-0 bottom-0 bg-slate-900/60 px-2 py-1 text-[11px] font-semibold text-white">
                    {String(a.kind).replace('_', ' ').toLowerCase()} · {time(a.at)}
                  </div>
                </a>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Patient confirmation">
          {!v.confirmation?.type ? (
            <div className="text-[13px] text-slate-400">Not confirmed yet</div>
          ) : (
            <div className="flex gap-4">
              <div className="grid flex-1 grid-cols-2 gap-3">
                <Field k="Method">{v.confirmation.type === 'PAD' ? 'Signature pad' : v.confirmation.type === 'OTP' ? 'OTP to patient phone' : 'Confirmed verbally'}</Field>
                <Field k="Time">{dateTime(v.confirmation.at)}</Field>
                <Field k="Name">{v.confirmation.name || '—'}</Field>
                <Field k="Relation">{v.confirmation.relation || '—'}</Field>
              </div>
              {signature && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/v1/attachments/${signature._id}`} alt="Signature" className="h-[92px] w-[170px] flex-none rounded-lg border border-slate-200 bg-white object-contain p-1" />
              )}
            </div>
          )}
        </Panel>
        <Panel title="Transport" right={r.transport?.status && <Tag tone={r.transport.status === 'DONE' ? 'green' : r.transport.status === 'IN_TRIP' ? 'blue' : 'slate'}>{r.transport.status.replace('_', ' ')}</Tag>}>
          {!r.transport?.needed && !r.transport?.mode ? (
            <div className="text-[13px] text-slate-400">No transport requested · team travels on their own</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field k="Mode">{r.transport.mode ? TRANSPORT_MODE_LABEL[r.transport.mode as 'UNICO_CAR'] : 'Requested'}</Field>
                <Field k="Car">{r.vehicle ? `${r.vehicle.name} · ${r.vehicle.plate}` : '—'}</Field>
                <Field k="Driver">{r.driver ? `${r.driver.name} · ${phone(r.driver.phone)}` : '—'}</Field>
                <Field k="Pick-up / return">
                  {time(r.transport.pickupAt)} / {time(r.transport.returnAt)}
                </Field>
              </div>
              {(r.transport.legs ?? []).length > 0 && (
                <div className="mt-3 flex flex-col">
                  {r.transport.legs.map((l: any) => (
                    <div key={l.key} className="flex items-center gap-3 border-t border-slate-100 py-1.5 text-[13px] first:border-t-0">
                      <Car size={14} className={l.at ? 'text-[#16A34A]' : 'text-slate-400'} />
                      <div className="flex-1">{l.label}</div>
                      <div className="text-slate-500">{l.at ? <b className="text-slate-800">{time(l.at)}</b> : l.plannedAt ? `plan ${time(l.plannedAt)}` : '—'}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </Panel>
        <Panel title="Petty cash">
          {(r.pettyCash ?? []).length === 0 ? (
            <div className="text-[13px] text-slate-400">No petty cash requested</div>
          ) : (
            <div className="flex flex-col gap-2">
              {r.pettyCash.map((p: any) => (
                <div key={p._id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <Wallet size={18} className="flex-none text-slate-400" />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-bold">
                      {taka(p.amount)} · {p.purpose}
                    </div>
                    <div className="text-slate-500">
                      {who(people, p.requestedBy)} · {dateTime(p.requestedAt)}
                      {p.note && ` · ${p.note}`}
                      {p.decidedBy && ` · ${p.status.toLowerCase()} by ${who(people, p.decidedBy)}`}
                    </div>
                  </div>
                  {p.status === 'PENDING' && canDecide ? (
                    <>
                      <ActionButton path={`/requests/${r._id}/petty-cash-decide`} body={{ pettyCashId: p._id, approve: false }} kind="o" size="sm" success="Petty cash rejected">
                        Reject
                      </ActionButton>
                      <ActionButton path={`/requests/${r._id}/petty-cash-decide`} body={{ pettyCashId: p._id, approve: true }} kind="p" size="sm" success="Petty cash approved">
                        Approve
                      </ActionButton>
                    </>
                  ) : (
                    <PettyTag status={p.status} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>
        <Panel
          title="Billing"
          right={
            reportHref && (
              <a href={reportHref} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-semibold text-primary-700 hover:underline">
                <FileText size={14} /> Visit report
              </a>
            )
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field k="Estimated fee">{taka(b.estimatedFee)}</Field>
            <Field k="Bill amount">{taka(b.billAmount)}</Field>
            <Field k="Paid / due">{b.status ? <Tag tone={b.status === 'PAID' ? 'green' : b.status === 'DUE' ? 'red' : 'slate'}>{b.status}</Tag> : '—'}</Field>
            <Field k="Method">{b.method ? PAYMENT_METHOD_LABEL[b.method as 'CASH'] : '—'}</Field>
            <Field k="Collected by">{b.collectedBy ? `${who(people, b.collectedBy)} · ${time(b.collectedAt)}` : '—'}</Field>
            <Field k="Invoice no.">{b.invoiceNo || '—'}</Field>
            <Field k="Invoice amount">
              {taka(b.invoiceAmount)}
              {match === true && <span className="ml-1.5 text-[12px] font-semibold text-[#15803D]">✓ matches bill</span>}
              {match === false && <span className="ml-1.5 text-[12px] font-semibold text-[#B45309]">≠ bill</span>}
            </Field>
            <Field k="Invoice print">{b.invoicePrinted == null ? '—' : b.invoicePrinted ? 'Printed' : 'Not printed'}</Field>
            <Field k="Reconciled" className="col-span-2">
              {b.reconciledBy ? `${who(people, b.reconciledBy)} · ${dateTime(b.reconciledAt)}` : '—'}
            </Field>
          </div>
        </Panel>
      </div>
    </div>
  )
}

// ================================================================ Messages
const CH_ICON: Record<string, ReactNode> = { EMAIL: <Mail size={15} />, WHATSAPP: <MessageCircle size={15} />, PUSH: <Bell size={15} />, SMS: <Smartphone size={15} /> }
const MSG_TONE: Record<string, Tone> = { PREPARED: 'slate', QUEUED: 'blue', SENT: 'green', SENT_CONFIRMED: 'green', DELIVERED: 'green', OPENED: 'green', FAILED: 'red', SKIPPED: 'amber' }

export function MessagesTab({ msgs, chat, people, canResend }: { msgs: any[]; chat: any[]; people: People; canResend: boolean }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
      <section className={cx(card, 'overflow-hidden')}>
        <div className="px-5 pb-3 pt-5">
          <div className="text-[15px] font-bold">Messages · {msgs.length}</div>
          <div className="text-[13px] text-slate-500">Email, WhatsApp and push sent for this request. Click a row to preview.</div>
        </div>
        <div className="grid h-11 grid-cols-[110px_1.1fr_1.3fr_120px_24px] items-center gap-2 border-y border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
          <div>Channel</div>
          <div>Template</div>
          <div>To</div>
          <div>Status</div>
          <div />
        </div>
        {msgs.length === 0 ? (
          <Empty icon={<Mail size={24} />} title="No messages yet" sub="Emails and WhatsApp messages sent from this record appear here." />
        ) : (
          msgs.map((m) => (
            <Expander
              key={m._id}
              head={
                <div className="grid grid-cols-[110px_1.1fr_1.3fr_120px] items-center gap-2 text-[13px]">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                    {CH_ICON[m.channel]} {m.channel === 'WHATSAPP' ? 'WhatsApp' : m.channel.charAt(0) + m.channel.slice(1).toLowerCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{m.templateKey || 'Free text'}</div>
                    <div className="text-[12px] text-slate-500">
                      {dateTime(m.at)} · {m.initiatedByName}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate">{m.toName || m.to}</div>
                    {m.toName && <div className="truncate text-[12px] text-slate-500">{m.to}</div>}
                  </div>
                  <div>
                    <Tag tone={MSG_TONE[m.status] ?? 'slate'}>{String(m.status).replace('_', ' ')}</Tag>
                  </div>
                </div>
              }
            >
              <div className="flex flex-col gap-2.5">
                {m.subject && (
                  <div className="text-[13px]">
                    <span className="text-slate-500">Subject:</span> <b>{m.subject}</b>
                  </div>
                )}
                {m.channel === 'EMAIL' ? <EmailPreview html={m.renderedHtml} text={m.renderedText} /> : <EmailPreview text={m.renderedText} />}
                {m.error && <div className="rounded-lg bg-[#FEE2E2] px-3 py-2 text-[12.5px] text-[#B91C1C]">{m.error}</div>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-500">
                  {(m.events ?? []).map((e: any, i: number) => (
                    <span key={i}>
                      {e.status} {time(e.at)}
                      {e.note && ` (${e.note})`}
                    </span>
                  ))}
                  {m.attempts > 0 && <span>· {m.attempts} attempt(s)</span>}
                  {canResend && m.channel === 'EMAIL' && ['FAILED', 'QUEUED', 'SKIPPED'].includes(m.status) && (
                    <span className="ml-auto">
                      <ResendButton id={m._id} />
                    </span>
                  )}
                </div>
              </div>
            </Expander>
          ))
        )}
      </section>
      <section className={cx(card, 'flex min-h-0 flex-col')}>
        <div className="border-b border-slate-200 px-5 pb-3 pt-5">
          <div className="text-[15px] font-bold">Care team chat · {chat.length}</div>
          <div className="text-[13px] text-slate-500">Read-only here · the team chats in the app</div>
        </div>
        {chat.length === 0 ? (
          <Empty icon={<MessageSquare size={24} />} title="No chat messages" />
        ) : (
          <div className="flex max-h-[640px] flex-col gap-2.5 overflow-y-auto bg-slate-50 p-4">
            {chat.map((c) =>
              c.kind === 'SYSTEM' ? (
                <div key={c._id} className="mx-auto max-w-[90%] rounded-full bg-slate-200 px-3 py-1 text-center text-[12px] text-slate-600">
                  {c.text} · {time(c.createdAt)}
                </div>
              ) : (
                <div key={c._id} className="flex gap-2">
                  <Avatar name={who(people, c.senderId)} size={28} tone="slate" />
                  <div className="min-w-0 max-w-[85%]">
                    <div className="text-[11.5px] text-slate-500">
                      <b className="text-slate-700">{who(people, c.senderId)}</b> · {time(c.createdAt)}
                    </div>
                    <div className="mt-0.5 rounded-xl rounded-tl-sm bg-white px-3 py-2 text-[13px] shadow-card">
                      {c.text}
                      {c.attachmentId && (
                        <a href={`/api/v1/attachments/${c.attachmentId}`} target="_blank" rel="noreferrer" className="mt-1 block">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`/api/v1/attachments/${c.attachmentId}`} alt="Chat photo" className="max-h-40 rounded-lg" loading="lazy" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ),
            )}
          </div>
        )}
      </section>
    </div>
  )
}

// ================================================================ Attachments
export function AttachmentsTab({ requestId, atts, people, canUpload, me }: { requestId: string; atts: any[]; people: People; canUpload: boolean; me: { id: string; admin: boolean } }) {
  return (
    <div className="flex flex-col gap-5">
      {canUpload && (
        <section className={cx(card, 'p-5')}>
          <div className="mb-3 text-[15px] font-bold">Add attachment</div>
          <AttachmentUploader requestId={requestId} />
          <div className="mt-2 text-[12px] text-slate-500">JPG, PNG, WEBP or PDF up to 3 MB. Photos are compressed and time-stamped.</div>
        </section>
      )}
      <section className={cx(card, 'p-5')}>
        <div className="text-[15px] font-bold">Files · {atts.length}</div>
        {atts.length === 0 ? (
          <Empty icon={<Paperclip size={24} />} title="No attachments" sub="Prescriptions, reports and visit photos for this request appear here." />
        ) : (
          <div className="mt-3.5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {atts.map((a) => {
              const img = String(a.mime).startsWith('image/')
              return (
                <div key={a._id} className="flex gap-3 rounded-card border border-slate-200 p-3">
                  <a href={`/api/v1/attachments/${a._id}`} target="_blank" rel="noreferrer" className="flex size-16 flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                    {img ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={`/api/v1/attachments/${a._id}`} alt={a.filename} className="size-full object-cover" loading="lazy" />
                    ) : (
                      <span className="flex h-12 w-10 items-center justify-center rounded bg-[#FEE2E2] text-[10px] font-bold text-[#B91C1C]">PDF</span>
                    )}
                  </a>
                  <div className="min-w-0 flex-1">
                    <a href={`/api/v1/attachments/${a._id}`} target="_blank" rel="noreferrer" className="block truncate text-[13.5px] font-semibold hover:underline">
                      {a.caption || a.filename}
                    </a>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <Tag tone={a.kind === 'PRESCRIPTION' ? 'blue' : a.kind === 'REPORT' || a.kind === 'VISIT_REPORT' ? 'violet' : 'slate'}>{String(a.kind).replace('_', ' ')}</Tag>
                      <span className="text-[12px] text-slate-500">{bytes(a.size)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-slate-500">
                      {who(people, a.uploadedBy)} · {ago(a.at)}
                    </div>
                  </div>
                  {(me.admin || String(a.uploadedBy) === me.id) && <DeleteAttachment id={a._id} name={a.filename ?? 'file'} />}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

// ================================================================ Audit
function fmtVal(v: any): string {
  if (v == null || v === '') return '∅'
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return dateTime(v)
  if (Array.isArray(v)) return v.length ? v.map(fmtVal).join(', ') : '[]'
  if (typeof v === 'object') return JSON.stringify(v).slice(0, 80)
  if (typeof v === 'boolean') return v ? 'yes' : 'no'
  return String(v)
}

function Diff({ before, after }: { before: any; after: any }) {
  const b = before && typeof before === 'object' ? before : {}
  const a = after && typeof after === 'object' ? after : {}
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])]
  if (!keys.length) return <span className="text-slate-400">—</span>
  return (
    <div className="flex flex-col gap-0.5">
      {keys.slice(0, 8).map((k) => (
        <div key={k} className="truncate text-[12.5px]">
          <span className="font-semibold text-slate-600">{k}</span>:{' '}
          {k in b && (
            <>
              <span className="rounded bg-[#FEE2E2] px-1 text-[#B91C1C] line-through decoration-[#B91C1C]/40">{fmtVal(b[k])}</span> →{' '}
            </>
          )}
          <span className="rounded bg-[#DCFCE7] px-1 text-[#15803D]">{fmtVal(a[k])}</span>
        </div>
      ))}
      {keys.length > 8 && <div className="text-[12px] text-slate-400">+{keys.length - 8} more</div>}
    </div>
  )
}

export function AuditTab({ rows }: { rows: any[] }) {
  return (
    <section className={cx(card, 'overflow-hidden')}>
      <div className="px-5 pb-3 pt-5">
        <div className="text-[15px] font-bold">Audit · {rows.length}</div>
        <div className="text-[13px] text-slate-500">Append-only record of every change to this request</div>
      </div>
      <div className="grid h-11 grid-cols-[140px_180px_170px_1fr] items-center border-y border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500">
        <div>When</div>
        <div>Who</div>
        <div>Action</div>
        <div>Before → after</div>
      </div>
      {rows.length === 0 ? (
        <Empty icon={<ScrollText size={24} />} title="No audit entries" />
      ) : (
        rows.map((a) => (
          <div key={a._id} className="grid grid-cols-[140px_180px_170px_1fr] items-start border-t border-slate-100 px-5 py-2.5 text-[13px] first:border-t-0">
            <div className="text-slate-600">
              {dateTime(a.serverAt)}
              <div className="text-[11.5px] text-slate-400">{date(a.serverAt)}</div>
            </div>
            <div className="min-w-0 pr-3">
              <div className="truncate font-semibold">{a.actorName}</div>
              <div className="truncate text-[12px] text-slate-500">
                {ROLE_LABEL[a.actorRole as Role] ?? a.actorRole}
                {a.client && ` · ${a.client}`}
                {a.ip && ` · ${a.ip}`}
              </div>
            </div>
            <div className="min-w-0 pr-3">
              <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-slate-700">{a.action}</span>
              {a.entityLabel && <div className="mt-0.5 truncate text-[12px] text-slate-500">{a.entityLabel}</div>}
            </div>
            <div className="min-w-0">
              <Diff before={a.before} after={a.after} />
            </div>
          </div>
        ))
      )}
    </section>
  )
}

