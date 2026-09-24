// Field app (M03–M15) presentational pieces. Server-safe: no hooks (live bits are small client islands).
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Check, ChevronLeft } from 'lucide-react'
import { StatusChip, PriorityBadge, Avatar } from '@/components/ui'
import { ContactBar } from '@/components/mobile'
import { Elapsed } from '@/components/client'
import { cx, time, minutesBetween, phone as fmtPhone } from '@/lib/format'
import { LATE_AFTER_MIN } from '@/lib/constants'
import { SyncBanner } from './live'

// ---------------------------------------------------------------- small helpers
export const svcName = (r: any) => (r.services ?? []).map((s: any) => s.name).join(' + ') || 'Home care visit'
export const ageG = (x: { ageYears?: number; gender?: string } | undefined) => [x?.ageYears != null ? String(x.ageYears) : '', x?.gender ?? ''].filter(Boolean).join(' ')
export const GENDER = { M: 'Male', F: 'Female', O: 'Other' } as Record<string, string>
export const vHref = (id: string, sub = '') => `/m/visits/${id}${sub ? `/${sub}` : ''}`

export function checklistStats(r: any) {
  const list: any[] = r.visit?.checklist ?? []
  const mand = list.filter((c) => c.mandatory)
  const done = list.filter((c) => c.done)
  const mandDone = mand.filter((c) => c.done)
  const last = done.map((c) => c.doneAt).filter(Boolean).sort().pop()
  return { total: list.length, done: done.length, mand: mand.length, mandDone: mandDone.length, missing: mand.filter((c) => !c.done), last }
}

/** "+4 min · on time" / "12 min late" relative to the scheduled time */
export function punctuality(r: any, at?: string | Date | null) {
  const late = r.visit?.lateMin != null && !at ? r.visit.lateMin : minutesBetween(r.scheduledAt, at ?? r.timeline?.checkInAt)
  if (late == null) return null
  if (late > LATE_AFTER_MIN) return { late: true, label: `${late} min late`, min: late }
  if (late < 0) return { late: false, label: `${-late} min early · on time`, min: late }
  return { late: false, label: `+${late} min · on time`, min: late }
}

// ---------------------------------------------------------------- header (with offline banner)
export function FHeader({ title, sub, back, right, below }: { title: ReactNode; sub?: ReactNode; back?: string; right?: ReactNode; below?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20">
      <SyncBanner />
      <header className="border-b border-slate-200 bg-white px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          {back ? (
            <Link href={back} className="flex size-10 flex-none items-center justify-center text-slate-700" aria-label="Back">
              <ChevronLeft size={22} />
            </Link>
          ) : (
            <div className="w-2" />
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-[17px] font-bold">{title}</div>
            {sub && <div className="truncate text-[13px] text-slate-500">{sub}</div>}
          </div>
          {right}
        </div>
        {below}
      </header>
    </div>
  )
}

/** Amber pulsing elapsed pill (M08-e / M09 header) */
export function ElapsedPill({ from }: { from?: string | null }) {
  if (!from) return null
  return (
    <span className="inline-flex h-7 flex-none items-center gap-1.5 rounded-full bg-[#FEF3C7] px-2.5 text-[13px] font-bold text-[#B45309]">
      <span className="size-[7px] animate-hcpulse rounded-full bg-[#F59E0B]" />
      <Elapsed from={from} />
    </span>
  )
}

// ---------------------------------------------------------------- visit card (M03 / M04)
export function VisitCard({ r, href, highlight, footer, muted }: { r: any; href: string; highlight?: boolean; footer?: ReactNode; muted?: boolean }) {
  return (
    <div className={cx('rounded-card bg-white px-3.5 py-3 shadow-card', highlight && 'outline outline-[1.5px] outline-primary')}>
      <Link href={href} className="flex items-center gap-3">
        <div className={cx('w-12 flex-none text-[15px] font-bold', muted ? 'text-slate-500' : 'text-slate-900')}>{r.scheduledAt ? time(r.scheduledAt) : '—'}</div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold">
            {r.patientSnapshot?.name} <span className="font-normal text-slate-500">· {ageG(r.patientSnapshot)}</span>
          </div>
          <div className="text-[13px] leading-[18px] text-slate-500">
            {svcName(r)}
            {r.patientSnapshot?.area ? ` · ${r.patientSnapshot.area}` : ''}
          </div>
        </div>
        <StatusChip status={r.status} sm />
      </Link>
      {footer && <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2.5">{footer}</div>}
    </div>
  )
}

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-center justify-between', className)}>
      <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">{children}</div>
      {right}
    </div>
  )
}

// ---------------------------------------------------------------- timeline stepper (M05-b)
type Step = { key: string; label: ReactNode; at?: string | null; sub?: ReactNode; right?: ReactNode }

export function TimelineStepper({ r }: { r: any }) {
  const t = r.timeline ?? {}
  const ck = checklistStats(r)
  const p = punctuality(r)
  const steps: Step[] = [
    { key: 'assigned', label: 'Assigned', at: t.assignedAt ?? r.assignment?.assignedAt },
    { key: 'accepted', label: 'Accepted', at: t.acceptedAt ?? r.assignment?.acceptedAt },
    { key: 'journey', label: 'Started journey', at: t.enRouteAt },
    {
      key: 'checkin',
      label: 'Checked in',
      at: t.checkInAt,
      sub: t.checkInAt && p ? <span className={cx('text-[12px] font-semibold', p.late ? 'text-[#B45309]' : 'text-[#15803D]')}>{p.label}</span> : null,
    },
    { key: 'checklist', label: 'Checklist', at: t.checkInAt && ck.mandDone === ck.mand ? ck.last ?? t.checkOutAt : null },
    { key: 'checkout', label: 'Check-out', at: t.checkOutAt },
    { key: 'complete', label: 'Complete', at: t.completedAt },
  ]
  // Journey is optional (ACCEPTED → check-in directly): treat it as skipped once checked in.
  const journeySkipped = !t.enRouteAt && !!t.checkInAt
  const ended = ['CANCELLED', 'RESCHEDULED'].includes(r.status)
  const cur = ended ? -1 : steps.findIndex((s) => !s.at && !(s.key === 'journey' && journeySkipped))
  const done = (i: number) => !!steps[i].at || (steps[i].key === 'journey' && journeySkipped)

  return (
    <div className="grid grid-cols-[20px_1fr_auto] gap-x-3">
      {steps.map((s, i) => {
        const isDone = done(i)
        const isCur = i === cur
        const last = i === steps.length - 1
        const lineColor = isDone ? (done(i + 1) ? '#16A34A' : i + 1 === cur ? '#F59E0B' : '#CBD5E1') : '#CBD5E1'
        const label =
          s.key === 'checklist' && ck.total ? (
            <>
              Checklist{' '}
              <span className={cx('font-medium', isCur ? 'text-[#B45309]' : isDone ? 'text-slate-500' : 'text-slate-400')}>
                {ck.done}/{ck.total}
              </span>
            </>
          ) : (
            s.label
          )
        let right: ReactNode = <span className="text-[14px] text-slate-300">—</span>
        if (s.at) right = <span className="text-[14px] text-slate-500">{time(s.at)}</span>
        else if (s.key === 'journey' && journeySkipped) right = <span className="text-[12px] text-slate-400">skipped</span>
        else if (isCur && s.key === 'checklist' && t.checkInAt)
          right = (
            <span className="text-[14px] font-bold text-[#B45309]">
              <Elapsed from={t.checkInAt} /> elapsed
            </span>
          )
        else if (isCur && s.key === 'accepted' && r.assignment?.respondBy) right = <span className="text-[13px] font-semibold text-[#B45309]">by {time(r.assignment.respondBy)}</span>
        return (
          <div key={s.key} className="contents">
            <div className="flex flex-col items-center">
              {isDone ? (
                <div className="flex size-5 items-center justify-center rounded-full bg-[#16A34A] text-white">
                  <Check size={12} strokeWidth={3.5} />
                </div>
              ) : isCur ? (
                <div className="size-5 rounded-full border-[3px] border-[#F59E0B] bg-white" />
              ) : (
                <div className="size-5 rounded-full border-2 border-slate-300 bg-white" />
              )}
              {!last && <div className="min-h-4 w-0.5 flex-1" style={{ background: lineColor }} />}
            </div>
            <div className={cx('text-[15px] leading-5', !last && 'pb-4', isCur ? 'font-bold text-slate-900' : isDone ? 'text-slate-700' : 'text-slate-400')}>
              {label}
              {s.sub && <div>{s.sub}</div>}
            </div>
            <div className="text-right">{right}</div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- patient card (M05-b)
export function PatientCard({ r, patient, compact }: { r: any; patient: any; compact?: boolean }) {
  const ps = r.patientSnapshot ?? {}
  const allergies: string[] = [...new Set<string>([...(patient?.allergies ?? []), ...(r.clinical?.allergies ?? [])])].filter(Boolean)
  const g = patient?.guardian
  const address = patient?.address?.full ? [patient.address.full, patient.address.area].filter(Boolean).join(', ') : ps.address
  return (
    <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
      <div className="flex items-center gap-3">
        <Avatar name={ps.name} size={48} />
        <div className="min-w-0 flex-1">
          <div className="text-[17px] font-bold leading-6">{ps.name}</div>
          <div className="text-[13px] text-slate-500">
            {[ps.ageYears != null ? String(ps.ageYears) : null, GENDER[ps.gender] ?? null, ps.uhid ? `MRN ${ps.uhid}` : null].filter(Boolean).join(' · ')}
          </div>
        </div>
        {allergies.length > 0 && (
          <span className="inline-flex min-h-6 max-w-[45%] items-center rounded-full bg-[#FEE2E2] px-2.5 py-0.5 text-[11px] font-bold leading-4 text-[#B91C1C]">Allergy · {allergies.join(', ')}</span>
        )}
      </div>
      {!compact && (
        <div className="mt-3 text-[14px] leading-5 text-slate-700">
          {address}
          {patient?.address?.landmark ? <span className="text-slate-500"> · near {patient.address.landmark}</span> : null}
          <br />
          {fmtPhone(ps.phone)}
          {g?.phone ? ` · ${(g.relation ?? '').toLowerCase()} ${g.name?.split(' ')[0] ?? ''} ${fmtPhone(g.phone)}` : ''}
        </div>
      )}
      <div className="mt-3">
        <ContactBar phone={ps.phone} address={address} lat={patient?.address?.lat} lng={patient?.address?.lng} />
      </div>
    </div>
  )
}

/** Card surface */
export function FCard({ children, className, pad = 'px-4 py-3.5' }: { children: ReactNode; className?: string; pad?: string }) {
  return <div className={cx('rounded-card bg-white shadow-card', pad, className)}>{children}</div>
}

export function HeadChips({ r }: { r: any }) {
  return (
    <div className="mt-1 flex gap-1.5">
      <StatusChip status={r.status} />
      <PriorityBadge priority={r.priority} />
    </div>
  )
}

/** Uppercase mini label + value (M06 summary / M07 tiles) */
export function Mini({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">{k}</div>
      <div className="mt-0.5 font-semibold">{v}</div>
    </div>
  )
}

/** Not-on-team notice for coordinators viewing a visit in the app */
export function ReadOnlyNote({ children }: { children?: ReactNode }) {
  return <div className="rounded-card bg-slate-200/70 px-4 py-3 text-[13px] text-slate-600">{children ?? 'You are viewing this visit. Only the assigned care team can record visit steps.'}</div>
}
