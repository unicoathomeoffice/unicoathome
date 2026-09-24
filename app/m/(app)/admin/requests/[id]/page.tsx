import Link from 'next/link'
import { ChevronRight, ClipboardList, NotebookPen, CalendarRange, FilePlus2, Car } from 'lucide-react'
import { MScreen, MCard, MList, MRow } from '@/components/mobile'
import { AutoRefresh } from '@/components/client'
import { SlaPill, PriorityBadge, Tag, Avatar } from '@/components/ui'
import { SLabel, ALink, bbtn } from '@/components/coord/ui'
import { PostButton, CancelRequestButton, RescheduleButton } from '@/components/coord/actions'
import { PatientSummaryCard, Line } from '@/components/coord/blocks'
import { requireDesk, loadCoordRequest, dhakaParts } from '@/components/coord/data'
import { Note } from '@/lib/models'
import { can, ROLE_LABEL, TRANSPORT_MODE_LABEL, PAYMENT_METHOD_LABEL } from '@/lib/constants'
import { relDay, time, dur, taka, dateTime, cx } from '@/lib/format'

export const metadata = { title: 'Request' }

const STEPS: [string, string][] = [
  ['requestedAt', 'Requested'],
  ['verifiedAt', 'Verified'],
  ['confirmedAt', 'Confirmed'],
  ['assignedAt', 'Assigned'],
  ['acceptedAt', 'Accepted'],
  ['enRouteAt', 'On the way'],
  ['checkInAt', 'Checked in'],
  ['checkOutAt', 'Checked out'],
  ['completedAt', 'Completed'],
  ['closedAt', 'Closed'],
  ['rescheduledAt', 'Rescheduled'],
  ['cancelledAt', 'Cancelled'],
]

/** Coordinator view of one request: compact summary + context actions. */
export default async function CoordRequest({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireDesk()
  const { id } = await params
  const { r, patient } = await loadCoordRequest(id, user)
  const notes = await Note.countDocuments({ requestId: r._id, deletedAt: null, $or: [{ visibility: 'TEAM' }, { authorId: user.id }, ...(can(user, 'requests.manage') ? [{ visibility: 'COORDINATOR' }] : [])] })
  const manage = can(user, 'requests.manage')
  const assign = can(user, 'requests.assign')
  const invoice = can(user, 'billing.invoice')
  const s = r.status as string
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const t = r.timeline ?? {}
  const { date } = dhakaParts(r.scheduledAt)
  const followUp = `/m/new-request?from=${id}&patientId=${r.patientId}`
  const pendingPc = (r.pettyCash ?? []).filter((p: any) => p.status === 'PENDING')

  let bottom: React.ReactNode = null
  if (s === 'NEW' || s === 'VERIFIED')
    bottom = manage ? (
      <>
        {s === 'NEW' && (
          <PostButton path={`/requests/${id}/verify`} kind="s" big className="flex-1" success="Verified">
            Verify
          </PostButton>
        )}
        <Link href={`/m/admin/requests/${id}/confirm`} className={bbtn('p', 'flex-[1.6]')}>
          Confirm request
        </Link>
      </>
    ) : null
  else if (s === 'CONFIRMED' || s === 'RESCHEDULED')
    bottom = assign ? (
      <>
        {manage && <RescheduleButton id={id} requestNo={r.requestNo} date={date} slot={r.slot} big className="flex-1" />}
        <Link href={`/m/admin/requests/${id}/assign`} className={bbtn('p', 'flex-[1.6]')}>
          Assign team
        </Link>
      </>
    ) : null
  else if (s === 'ASSIGNED' || s === 'ACCEPTED')
    bottom = (
      <>
        {manage && <RescheduleButton id={id} requestNo={r.requestNo} date={date} slot={r.slot} big className="flex-1" />}
        {assign ? (
          <Link href={`/m/admin/requests/${id}/assign`} className={bbtn('p', 'flex-[1.6]')}>
            Reassign
          </Link>
        ) : (
          <Link href={`/m/visits/${id}`} className={bbtn('p', 'flex-[1.6]')}>
            Open field detail
          </Link>
        )}
      </>
    )
  else if (s === 'EN_ROUTE' || s === 'IN_PROGRESS')
    bottom = (
      <Link href={`/m/visits/${id}`} className={bbtn('p', 'flex-1')}>
        Open field detail
      </Link>
    )
  else if (s === 'COMPLETED')
    bottom = invoice ? (
      <Link href={`/m/admin/requests/${id}/close`} className={bbtn('g', 'flex-1')}>
        Verify report & close
      </Link>
    ) : null
  else
    bottom = (
      <Link href={followUp} className={bbtn('p', 'flex-1')}>
        New follow-up request
      </Link>
    )

  return (
    <MScreen title={r.requestNo} sub={(r.services ?? []).map((x: any) => x.name).join(', ')} back="/m/admin/inbox" right={<PriorityBadge priority={r.priority} />} bottom={bottom} bottomNote={pendingPc.length && s === 'COMPLETED' ? `${pendingPc.length} petty cash request waiting for a decision` : undefined}>
      <AutoRefresh seconds={30} />
      <PatientSummaryCard
        r={r}
        patient={patient}
        extra={
          r.sla && (
            <div className="mt-2.5">
              <SlaPill tone={r.sla.tone} label={r.sla.label} />
            </div>
          )
        }
      />

      <MCard>
        <Line k="When" v={r.scheduledAt ? `${relDay(r.scheduledAt)} · ${time(r.scheduledAt)}${r.slot ? ` · slot ${r.slot}` : ''}` : r.preferred?.date ? `Prefers ${r.preferred.date}${r.preferred.time ? ` ${r.preferred.time}` : ''}${r.preferred.slot ? ` · ${r.preferred.slot}` : ''}` : 'Not set'} />
        <Line k="Duration" v={dur(r.expectedDurationMin)} />
        <Line k="Address" v={r.patientSnapshot?.address} />
        <Line k="UHID" v={r.patientSnapshot?.uhid ?? <span className="text-[#B45309]">Not looked up yet</span>} />
        <Line
          k="Tests"
          v={
            r.tests?.length ? (
              <div className="flex flex-wrap gap-1">
                {r.tests.map((x: string) => (
                  <Tag key={x} tone="blue">
                    {x}
                  </Tag>
                ))}
              </div>
            ) : (
              '—'
            )
          }
        />
        {r.clinical?.complaint && <Line k="Notes" v={r.clinical.complaint} />}
        {r.clinical?.referringDoctor && <Line k="Referred by" v={r.clinical.referringDoctor} />}
        {!!r.clinical?.allergies?.length && <Line k="Allergies" v={<span className="font-semibold text-[#B91C1C]">{r.clinical.allergies.join(', ')}</span>} />}
        {r.remarks && <Line k="Remarks" v={r.remarks} />}
      </MCard>

      <SLabel right={r.assignment?.teamSize ? `team of ${r.assignment.teamSize}` : undefined}>Care team</SLabel>
      {team.length ? (
        <MList>
          {team.map((m: any, i: number) => (
            <MRow key={m.id}>
              <Avatar name={m.name} size={36} tone={i === 0 ? 'blue' : 'slate'} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold">{m.name}</div>
                <div className="truncate text-[12px] text-slate-500">
                  {m.designation ?? ROLE_LABEL[m.role as keyof typeof ROLE_LABEL]} · {m.employeeId}
                  {i === 0 ? ' · primary' : ''}
                </div>
              </div>
              {i === 0 && (t.acceptedAt ? <Tag tone="green">Accepted {time(t.acceptedAt)}</Tag> : s === 'ASSIGNED' ? <Tag tone="amber">Awaiting</Tag> : null)}
            </MRow>
          ))}
        </MList>
      ) : (
        <MCard className="text-[14px] text-slate-500">No team yet{assign && ['CONFIRMED', 'RESCHEDULED'].includes(s) ? ' — assign one below.' : '.'}</MCard>
      )}

      {(r.transport?.needed || r.transport?.mode) && (
        <>
          <SLabel>Transport</SLabel>
          <MCard>
            <div className="flex items-center gap-3">
              <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-[#CFFAFE] text-[#0E7490]">
                <Car size={20} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">
                  {r.vehicle ? `${r.vehicle.name} · ${r.vehicle.plate}` : r.transport?.mode ? TRANSPORT_MODE_LABEL[r.transport.mode as keyof typeof TRANSPORT_MODE_LABEL] : 'Car requested'}
                </div>
                <div className="text-[12px] text-slate-500">
                  {r.driver ? `Driver ${r.driver.name}` : r.transport?.status === 'REQUESTED' ? 'Waiting for the car supervisor' : r.transport?.status === 'OWN' ? 'Own transport' : ''}
                  {r.transport?.pickupAt ? ` · pick-up ${time(r.transport.pickupAt)}` : ''}
                </div>
              </div>
              {r.transport?.status && <Tag tone={r.transport.status === 'REQUESTED' ? 'amber' : r.transport.status === 'DONE' ? 'green' : 'blue'}>{r.transport.status.replace('_', ' ')}</Tag>}
            </div>
          </MCard>
        </>
      )}

      <SLabel>Billing</SLabel>
      <MCard>
        <Line k="Estimate" v={taka(r.billing?.estimatedFee)} />
        {r.billing?.billAmount != null && <Line k="Bill" v={`${taka(r.billing.billAmount)} · ${r.billing.status === 'PAID' ? 'Paid' : r.billing.status === 'DUE' ? 'Payment due' : r.billing.status ?? ''}${r.billing.method ? ` · ${PAYMENT_METHOD_LABEL[r.billing.method as keyof typeof PAYMENT_METHOD_LABEL]}` : ''}`} />}
        {r.billing?.invoiceNo && <Line k="Invoice" v={`${r.billing.invoiceNo} · ${taka(r.billing.invoiceAmount)} · ${r.billing.invoicePrinted ? 'printed' : 'not printed'}`} />}
        {(r.pettyCash ?? []).map((p: any) => (
          <Line key={String(p._id)} k="Petty cash" v={`${taka(p.amount)} · ${p.purpose} · ${p.status.toLowerCase()}`} />
        ))}
      </MCard>

      <MList>
        {!['NEW', 'VERIFIED', 'CONFIRMED', 'RESCHEDULED', 'CANCELLED'].includes(s) && <LinkRow href={`/m/visits/${id}`} icon={<ClipboardList size={20} />} title="Field visit detail" sub="Checklist, vitals, notes, photos" />}
        <LinkRow href={`/m/notes?requestId=${id}`} icon={<NotebookPen size={20} />} title="Notes" sub={notes ? `${notes} note${notes === 1 ? '' : 's'} on this visit` : 'Add a note or handover'} />
        {r.carePlanId && <LinkRow href={`/m/care-plans/${r.carePlanId}`} icon={<CalendarRange size={20} />} title="Care plan" sub="Part of a recurring plan" />}
        <LinkRow href={followUp} icon={<FilePlus2 size={20} />} title="Follow-up request" sub="Same patient, new visit" />
      </MList>

      <SLabel>Timeline</SLabel>
      <MCard pad="px-4 py-3">
        {STEPS.filter(([k]) => t[k]).map(([k, label], i, arr) => (
          <div key={k} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cx('mt-1 size-2.5 rounded-full', k === 'cancelledAt' ? 'bg-[#DC2626]' : 'bg-primary')} />
              {i < arr.length - 1 && <div className="w-px flex-1 bg-slate-200" />}
            </div>
            <div className="flex-1 pb-2.5 text-[14px]">
              <span className="font-semibold">{label}</span> <span className="text-slate-500">· {dateTime(t[k])}</span>
            </div>
          </div>
        ))}
        {r.cancellation?.reason && <div className="text-[13px] text-[#B91C1C]">Reason: {r.cancellation.reason}</div>}
      </MCard>

      {manage && !['COMPLETED', 'CLOSED', 'CANCELLED', 'EN_ROUTE', 'IN_PROGRESS'].includes(s) && (
        <div className="flex gap-2">
          {['ASSIGNED', 'ACCEPTED'].includes(s) && <ALink href={`/m/visits/${id}`} kind="soft" className="flex-1">Field detail</ALink>}
          <CancelRequestButton id={id} requestNo={r.requestNo} kind="r" className="flex-1" label="Cancel request" />
        </div>
      )}
    </MScreen>
  )
}

function LinkRow({ href, icon, title, sub }: { href: string; icon: React.ReactNode; title: string; sub: string }) {
  return (
    <MRow href={href}>
      <div className="flex size-10 flex-none items-center justify-center rounded-[10px] bg-primary-50 text-primary-700">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="truncate text-[13px] text-slate-500">{sub}</div>
      </div>
      <ChevronRight size={18} className="text-slate-400" />
    </MRow>
  )
}
