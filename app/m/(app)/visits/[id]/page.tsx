import Link from 'next/link'
import { Car, ChevronRight, ClipboardCheck, FileText, HeartPulse, Camera, PenLine, LogOut, Phone, UsersRound } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { AutoRefresh } from '@/components/client'
import { Avatar, Progress, Tag, telUrl } from '@/components/ui'
import { FHeader, HeadChips, TimelineStepper, PatientCard, SectionLabel, checklistStats, svcName, vHref, ReadOnlyNote } from '@/components/field'
import { loadVisit, coordinatorOnDuty } from '@/components/field/data'
import { VisitActionBar, OverflowMenu, TimerWidget, PettyCash } from '@/components/field/visit'
import { TestsCard } from '@/components/field/tests'
import { LabResult, User } from '@/lib/models'
import { can, TRANSPORT_MODE_LABEL, PAYMENT_METHOD_LABEL, STATUS_LABEL } from '@/lib/constants'
import { getSettings } from '@/lib/settings'
import { cx, time, relDay, dur, taka, dateTime } from '@/lib/format'
import { plain } from '@/lib/db'

export const metadata = { title: 'Visit' }

const KIND: Record<string, string> = {
  PRESCRIPTION: 'Prescription',
  REPORT: 'Report',
  WOUND_PHOTO: 'Wound',
  DRESSING_PHOTO: 'Dressing',
  SAMPLE_LABEL: 'Sample label',
  SIGNATURE: 'Signature',
  VISIT_REPORT: 'Visit report',
  PHOTO: 'Photo',
  OTHER: 'File',
}

/** M05 Visit detail — "By the book" (M05-b) with the live timer from M05-c once in progress. */
export default async function VisitDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ respond?: string }> }) {
  const { id } = await params
  const sp = await searchParams
  const { user, r, patient, team, primary, attachments } = await loadVisit(id, { attachments: true })
  const [settings, coord, labs, assignedBy] = await Promise.all([
    getSettings(),
    coordinatorOnDuty(),
    LabResult.find({ requestId: r._id }).select('test status flag value unit summary').lean<any[]>(),
    r.assignment?.assignedBy ? User.findById(r.assignment.assignedBy).select('name').lean<any>() : null,
  ])
  const ck = checklistStats(r)
  const t = r.timeline ?? {}
  const v = r.visit ?? {}
  const vit = v.vitals ?? {}
  const photos = attachments.filter((a: any) => ['WOUND_PHOTO', 'DRESSING_PHOTO', 'SAMPLE_LABEL', 'PHOTO'].includes(a.kind))
  const docs = attachments.filter((a: any) => a.kind !== 'SIGNATURE')
  const canFollowUp = can(user, 'requests.create')
  const labMap = Object.fromEntries(plain(labs).map((l: any) => [l.test, l]))
  const inProgress = r.status === 'IN_PROGRESS'
  const checkedIn = !!t.checkInAt
  const shortName = (n?: string) => (n ? n.replace(/^(Dr\.?|Md\.?)\s+/i, '').split(' ').slice(0, 2).join(' ') : '')

  return (
    <MScreen
      header={<FHeader back="/m/visits" title={r.requestNo} sub={<HeadChips r={r} />} right={<OverflowMenu r={r} team={team} canFollowUp={canFollowUp} coordinatorPhone={coord?.phone} />} />}
      bottom={
        <VisitActionBar
          r={r}
          team={team}
          primary={primary}
          assignedBy={assignedBy ? shortName(assignedBy.name) : null}
          missing={ck.missing.length}
          ckDone={ck.done}
          ckTotal={ck.total}
          autoRespond={sp.respond === '1' || r.status === 'ASSIGNED'}
          canFollowUp={canFollowUp}
        />
      }
    >
      <Col>
      <AutoRefresh seconds={30} />
      {inProgress && t.checkInAt && (
        <TimerWidget checkInAt={t.checkInAt} scheduledAt={r.scheduledAt} plannedMin={r.expectedDurationMin ?? 45} lateMin={v.lateMin} overtimePct={settings.sla.overtimePct} lateAfter={settings.sla.lateAfterMin} serverNow={Date.now()} />
      )}

      {r.status === 'CANCELLED' && (
        <div className="rounded-card bg-[#FEE2E2] px-4 py-3 text-[14px] text-[#B91C1C]">
          <b>Cancelled {dateTime(r.cancellation?.at ?? t.cancelledAt)}</b>
          {r.cancellation?.reason ? ` · ${r.cancellation.reason}` : ''}
        </div>
      )}

      <div className="rounded-card bg-white p-4 shadow-card">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <SectionLabel>Timeline</SectionLabel>
          <div className="text-[12px] text-slate-500">
            {r.scheduledAt ? `Scheduled ${relDay(r.scheduledAt) === 'Today' ? '' : relDay(r.scheduledAt) + ' '}${time(r.scheduledAt)} · ${r.expectedDurationMin ?? 45} min` : 'Not scheduled yet'}
          </div>
        </div>
        <TimelineStepper r={r} />
      </div>

      {!team && <ReadOnlyNote />}

      <PatientCard r={r} patient={patient} />

      {checkedIn && team && (
        <>
          <SectionLabel className="mt-1">{inProgress ? 'Remaining steps' : 'Visit record'}</SectionLabel>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
            <StepRow
              href={vHref(id, 'checklist')}
              icon={ClipboardCheck}
              current={inProgress && ck.missing.length > 0}
              title="Checklist"
              sub={`${ck.done} of ${ck.total} done${ck.missing.length ? ` · ${ck.missing.length} mandatory left` : ' · all mandatory done'}`}
              right={<Progress value={ck.done} max={ck.total || 1} color={ck.missing.length ? '#F59E0B' : '#16A34A'} className="w-20" />}
            />
            <StepRow
              href={vHref(id, 'vitals')}
              icon={HeartPulse}
              title="Vitals"
              sub={vit.recordedAt ? `Recorded ${time(vit.recordedAt)}${vit.bpSys ? ` · BP ${vit.bpSys}/${vit.bpDia ?? '—'}` : ''}${vit.abnormal?.length ? ` · ${vit.abnormal.length} abnormal` : ''}` : 'Not recorded yet'}
              done={!!vit.recordedAt}
              warn={!!vit.abnormal?.length}
            />
            <StepRow
              href={vHref(id, 'photos')}
              icon={Camera}
              title="Photos"
              sub={photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'} · last ${time(photos[photos.length - 1].at)}` : 'Optional · wound, dressing, sample label'}
              done={photos.length > 0}
            />
            <StepRow
              href={vHref(id, 'notes')}
              icon={FileText}
              title="Notes & medications"
              sub={[v.notes?.nursing || v.notes?.clinical ? `Notes saved ${time(v.notes?.updatedAt)}` : 'No notes yet', v.medications?.length ? `${v.medications.length} medication${v.medications.length === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ')}
              done={!!(v.notes?.nursing || v.notes?.clinical || v.medications?.length)}
            />
            <StepRow
              href={vHref(id, 'confirm')}
              icon={PenLine}
              title="Patient confirmation"
              sub={v.confirmation?.at ? `${{ PAD: 'Signature', OTP: 'OTP', VERBAL: 'Verbal' }[v.confirmation.type as 'PAD'] ?? ''} · ${time(v.confirmation.at)}${v.confirmation.name ? ` · ${v.confirmation.name}` : ''}` : 'Signature, OTP or verbal'}
              done={!!v.confirmation?.at}
            />
            {inProgress && (
              <StepRow
                href={vHref(id, 'checkout')}
                icon={LogOut}
                title="Check-out & complete"
                sub={ck.missing.length ? 'Unlocks after mandatory items' : 'Ready · bill and payment status'}
                current={!ck.missing.length}
                disabled={ck.missing.length > 0}
              />
            )}
          </div>
        </>
      )}

      {checkedIn && !inProgress && (
        <div className="rounded-card bg-white p-4 shadow-card">
          <SectionLabel>Service time</SectionLabel>
          <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
            <Tile k="Start" v={time(t.checkInAt)} />
            <Tile k="End" v={time(t.checkOutAt)} />
            <Tile k="Duration" v={dur(v.durationMin)} />
          </div>
          {r.billing?.billAmount != null && (
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[14px]">
              <span className="text-slate-500">Bill</span>
              <span className="font-bold">
                {taka(r.billing.billAmount)}{' '}
                <Tag tone={r.billing.status === 'PAID' ? 'green' : 'amber'}>{r.billing.status === 'PAID' ? `Paid · ${PAYMENT_METHOD_LABEL[r.billing.method as 'CASH'] ?? ''}` : 'Payment due'}</Tag>
              </span>
            </div>
          )}
        </div>
      )}

      <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
        <SectionLabel>Service &amp; instructions</SectionLabel>
        <div className="mt-1.5 text-[15px] font-semibold">{svcName(r)}</div>
        {r.clinical?.complaint && <div className="mt-1 text-[14px] leading-5 text-slate-700">{r.clinical.complaint}</div>}
        {r.assignment?.instructions && (
          <div className="mt-2 rounded-lg bg-[#FFFBEB] px-3 py-2 text-[14px] leading-5 text-slate-800">
            <span className="font-semibold text-[#B45309]">Coordinator: </span>
            {r.assignment.instructions}
          </div>
        )}
        {r.clinical?.referringDoctor && <div className="mt-1.5 text-[13px] text-slate-500">Referred by {r.clinical.referringDoctor}</div>}
        {docs.length > 0 && (
          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto">
            {docs.map((a: any) => (
              <a key={a._id} href={`/api/v1/attachments/${a._id}`} target="_blank" rel="noreferrer" className="relative size-[72px] flex-none overflow-hidden rounded-lg border border-dashed border-slate-300 bg-slate-100">
                {a.mime?.startsWith('image/') ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/v1/attachments/${a._id}`} alt={a.caption ?? KIND[a.kind]} className="size-full object-cover" loading="lazy" />
                ) : (
                  <FileText size={24} className="absolute left-1/2 top-4 -translate-x-1/2 text-slate-400" />
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-white/85 px-1 py-0.5 text-center text-[10px] text-slate-600">{a.caption || KIND[a.kind] || 'File'}</span>
              </a>
            ))}
          </div>
        )}
      </div>

      <TestsCard id={id} tests={r.tests ?? []} labs={labMap} canEdit={team && !['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)} />

      {r.transport?.needed || r.transport?.mode ? (
        <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
          <div className="flex items-center justify-between">
            <SectionLabel>Transport</SectionLabel>
            {r.driver?.phone && (
              <a href={telUrl(r.driver.phone)} className="flex h-9 items-center gap-1 text-[13px] font-semibold text-primary-700">
                <Phone size={14} /> Call driver
              </a>
            )}
          </div>
          {r.transport.mode === 'UNICO_CAR' && r.vehicle ? (
            <div className="mt-2 flex items-center gap-3">
              <Avatar name={r.driver?.name} size={40} tone="amber" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold">
                  {r.vehicle.name} · {r.driver?.name ?? 'Driver TBC'}
                </div>
                <div className="text-[12px] text-slate-500">
                  {r.vehicle.plate} · pick-up {time(r.transport.pickupAt)} · return ~{time(r.transport.returnAt)}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3 text-[14px]">
              <span className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                <Car size={18} />
              </span>
              <div>
                <div className="font-semibold">{r.transport.status === 'REQUESTED' ? 'Car requested' : r.transport.mode ? TRANSPORT_MODE_LABEL[r.transport.mode as 'UBER'] : 'Own transport'}</div>
                <div className="text-[12px] text-slate-500">{r.transport.status === 'REQUESTED' ? 'Waiting for the car supervisor to assign a car' : 'Own arrangement · claim fare via petty cash if needed'}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}

      <PettyCash r={r} team={team} />

      <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
        <div className="flex items-center justify-between">
          <SectionLabel>Care team</SectionLabel>
          <UsersRound size={16} className="text-slate-400" />
        </div>
        <div className="mt-2 flex flex-col gap-2">
          {[r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean).map((s: any, i: number) => (
            <div key={s.id} className="flex items-center gap-3">
              <Avatar name={s.name} size={36} tone={i ? 'slate' : 'blue'} />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold">
                  {s.name}
                  {s.id === user.id ? ' (you)' : ''}
                </div>
                <div className="text-[12px] text-slate-500">
                  {i === 0 ? 'Primary' : 'Team'} · {s.designation ?? s.role} · {s.employeeId}
                </div>
              </div>
              {s.id !== user.id && s.phone && (
                <a href={telUrl(s.phone)} className="flex size-10 items-center justify-center rounded-[10px] bg-slate-100 text-primary-700" aria-label={`Call ${s.name}`}>
                  <Phone size={16} />
                </a>
              )}
            </div>
          ))}
          {!r.primaryStaff && <div className="text-[13px] text-slate-500">Not assigned yet · {STATUS_LABEL[r.status as 'NEW']}</div>}
        </div>
      </div>
      </Col>
    </MScreen>
  )
}

function Tile({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">{k}</div>
      <div className="mt-0.5 text-[20px] font-bold">{v}</div>
    </div>
  )
}

function StepRow({ href, icon: I, title, sub, right, done, warn, current, disabled }: { href: string; icon: any; title: string; sub: string; right?: React.ReactNode; done?: boolean; warn?: boolean; current?: boolean; disabled?: boolean }) {
  return (
    <Link href={href} className={cx('relative flex min-h-16 items-center gap-3 px-4 py-3 active:bg-slate-50', disabled && 'opacity-60')}>
      {current && <span className="absolute inset-y-0 left-0 w-1 bg-[#F59E0B]" />}
      <span className={cx('flex size-9 flex-none items-center justify-center rounded-[10px]', warn ? 'bg-[#FEF3C7] text-[#B45309]' : done ? 'bg-[#DCFCE7] text-[#15803D]' : 'bg-primary-50 text-primary-700')}>
        <I size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold">{title}</span>
        <span className="block truncate text-[12px] text-slate-500">{sub}</span>
      </span>
      {right}
      {done && !right && <span className="text-[12px] font-bold text-[#15803D]">Done</span>}
      <ChevronRight size={18} className="flex-none text-slate-400" />
    </Link>
  )
}
