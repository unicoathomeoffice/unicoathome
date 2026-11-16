'use client'
// The patient's home care module (/my), view only: overview, health records, bills, documents, repeating visits.
// Data arrives from lib/services/patient-module.ts (the patient's own records only — no staff contacts, no tracking).
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Activity, AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, ChevronRight, FileText, FlaskConical, HeartPulse, Pill, Receipt, Repeat, Wallet } from 'lucide-react'
import type { PatientModule } from '@/lib/services/patient-module'
import { clock, cx, date, dateTime, relDay, taka, time } from '@/lib/format'
import { useLang } from '@/components/public/i18n'
import { RequestList, StatusPill, type RequestCard } from './RequestCards'

const card = 'rounded-2xl bg-white p-4 shadow-[0_6px_24px_rgba(31,56,100,0.07)] ring-1 ring-slate-100 sm:p-5'
const fileUrl = (id: string) => `/api/v1/patient/files/${id}`

export function PageHead({ title, sub, icon }: { title: string; sub?: ReactNode; icon: ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-3 lg:hidden">
      <span className="flex size-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-teal text-white shadow-sm">{icon}</span>
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold leading-tight text-navy">{title}</h1>
        {sub && <div className="text-[13px] text-slate-500">{sub}</div>}
      </div>
    </div>
  )
}

function Box({ title, icon, right, children, className }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx(card, className)}>
      <div className="mb-3 flex items-center gap-2">
        {icon && <span className="text-primary-700">{icon}</span>}
        <h2 className="text-[16px] font-bold text-slate-900">{title}</h2>
        <span className="flex-1" />
        {right}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => <div className="rounded-xl bg-slate-50 px-4 py-6 text-center text-[14px] text-slate-500">{children}</div>

function Stat({ label, value, icon, tone, href }: { label: string; value: ReactNode; icon: ReactNode; tone: string; href: string }) {
  return (
    <Link href={href} className={cx(card, 'group flex items-center gap-3 !p-4 transition hover:-translate-y-px')}>
      <span className={cx('flex size-11 flex-none items-center justify-center rounded-xl text-white shadow-sm', tone)}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">{label}</span>
        <span className="block truncate text-[21px] font-bold leading-tight text-slate-900">{value}</span>
      </span>
    </Link>
  )
}

// ==================================================================== overview
export function OverviewView({ m, name, current }: { m: PatientModule; name: string; current: RequestCard[] }) {
  const { t } = useLang()
  const v = m.vitals[0]
  const n = m.next
  const facts = [m.profile.uhid && `${t.uhidLabel} ${m.profile.uhid}`, m.profile.ageYears != null && `${m.profile.ageYears} y`, m.profile.gender === 'M' ? t.male : m.profile.gender === 'F' ? t.female : null, m.profile.category, m.profile.company].filter(Boolean) as string[]
  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <section className="relative overflow-hidden rounded-[22px] bg-gradient-to-br from-navy via-[#1B5A8C] to-primary p-5 text-white shadow-lg shadow-navy/20 sm:p-6">
        <span className="pointer-events-none absolute -right-16 -top-16 size-56 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -bottom-20 right-24 size-40 rounded-full bg-teal/30 blur-2xl" />
        <div className="relative">
          <div className="text-[12.5px] font-semibold uppercase tracking-[.08em] text-white/70">
            {t.hello}, {name.split(' ')[0]}
          </div>
          <h1 className="mt-1 text-[24px] font-bold leading-tight sm:text-[28px]">{name}</h1>
          {facts.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {facts.map((f) => (
                <span key={f} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[12px] font-semibold ring-1 ring-white/20">
                  {f}
                </span>
              ))}
            </div>
          )}
          {m.profile.address && <div className="mt-2 max-w-[640px] text-[13px] text-white/80">{m.profile.address}</div>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/?book=1#book" className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-4 text-[14px] font-bold text-primary-700 shadow-sm hover:bg-primary-50">
              <CalendarCheck size={16} /> {t.newRequest}
            </Link>
            <Link href="/my/visits" className="inline-flex h-10 items-center gap-2 rounded-full bg-white/15 px-4 text-[14px] font-semibold ring-1 ring-white/30 hover:bg-white/25">
              {t.navMyVisits} <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat href="/my/visits" label={t.upcomingVisits} value={m.counts.upcoming} icon={<CalendarClock size={20} />} tone="bg-gradient-to-br from-primary to-[#1FB6E8]" />
        <Stat href="/my/visits" label={t.visitsDone} value={m.counts.done} icon={<CheckCircle2 size={20} />} tone="bg-gradient-to-br from-[#16A34A] to-teal" />
        <Stat href="/my/bills" label={t.amountDue} value={m.counts.due > 0 ? taka(m.counts.due) : t.allPaid} icon={<Wallet size={20} />} tone={m.counts.due > 0 ? 'bg-gradient-to-br from-[#E2136E] to-[#F43F5E]' : 'bg-gradient-to-br from-slate-500 to-slate-400'} />
        <Stat href="/my/documents" label={t.docsCount} value={m.counts.docs} icon={<FileText size={20} />} tone="bg-gradient-to-br from-[#7C3AED] to-[#A855F7]" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px] lg:items-start">
        <div className="flex flex-col gap-4">
          <Box title={t.nextVisit} icon={<CalendarClock size={18} />}>
            {n ? (
              <Link href={`/my/requests/${n.id}`} className="group flex items-center gap-4 rounded-xl bg-primary-50/60 p-3.5 ring-1 ring-primary/15 hover:bg-primary-50">
                <span className="flex w-[84px] flex-none flex-col items-center rounded-xl bg-white px-1 py-2 text-center shadow-sm">
                  <span className="text-[11px] font-bold uppercase text-primary-700">{n.at ? relDay(n.at) : n.preferred ? relDay(n.preferred) : '—'}</span>
                  <span className="text-[16px] font-bold text-navy">{n.at ? time(n.at) : n.slot ? clock(n.slot).split('–')[0] : '—'}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <StatusPill status={n.status} />
                  <span className="mt-1 block truncate text-[15.5px] font-bold text-slate-900">{n.service}</span>
                  {n.slot && <span className="block text-[12.5px] text-slate-500">{clock(n.slot)}</span>}
                </span>
                <ChevronRight size={20} className="text-slate-300 group-hover:text-primary" />
              </Link>
            ) : (
              <Empty>{t.noNextVisit}</Empty>
            )}
          </Box>
          <Box title={t.current} icon={<CalendarCheck size={18} />} right={<Link href="/my/visits" className="text-[13px] font-semibold text-primary-700 hover:underline">{t.viewAll}</Link>}>
            <RequestList items={current.slice(0, 3)} emptyKey="noCurrent" />
          </Box>
        </div>
        <div className="flex flex-col gap-4">
          <Box title={t.latestVitals} icon={<HeartPulse size={18} />} right={<Link href="/my/health" className="text-[13px] font-semibold text-primary-700 hover:underline">{t.viewAll}</Link>}>
            {v ? (
              <>
                <div className="mb-2 text-[12.5px] text-slate-500">{dateTime(v.at)}</div>
                <div className="grid grid-cols-2 gap-2">
                  {vitalTiles(v).map((x) => (
                    <div key={x.label} className={cx('rounded-xl px-3 py-2 ring-1', x.out ? 'bg-[#FEF2F2] ring-[#FECACA]' : 'bg-slate-50 ring-slate-100')}>
                      <div className="text-[11px] font-semibold uppercase tracking-[.04em] text-slate-500">{x.label}</div>
                      <div className={cx('text-[16px] font-bold', x.out ? 'text-[#B91C1C]' : 'text-slate-900')}>
                        {x.value} <span className="text-[11.5px] font-medium text-slate-400">{x.unit}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <Empty>{t.noVitals}</Empty>
            )}
          </Box>
          {m.counts.due > 0 && <BkashCard due={m.counts.due} />}
        </div>
      </div>
    </div>
  )
}

/** BP as one tile (120/80), the rest as they are */
function vitalTiles(v: PatientModule['vitals'][number]) {
  const sys = v.values.find((x) => x.key === 'bpSys')
  const dia = v.values.find((x) => x.key === 'bpDia')
  const rest = v.values.filter((x) => x.key !== 'bpSys' && x.key !== 'bpDia').map((x) => ({ label: x.label, value: String(x.value), unit: x.unit, out: x.out }))
  return [...(sys || dia ? [{ label: 'BP', value: `${sys?.value ?? '—'}/${dia?.value ?? '—'}`, unit: 'mmHg', out: !!(sys?.out || dia?.out) }] : []), ...rest]
}

// ==================================================================== visits
export function VisitsView({ current, past }: { current: RequestCard[]; past: RequestCard[] }) {
  const { t } = useLang()
  return (
    <>
      <PageHead title={t.navMyVisits} icon={<CalendarCheck size={20} />} />
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Box title={t.current} icon={<CalendarClock size={18} />} right={<Count n={current.length} />}>
          <RequestList items={current} emptyKey="noCurrent" />
        </Box>
        <Box title={t.past} icon={<CheckCircle2 size={18} />} right={<Count n={past.length} />}>
          <RequestList items={past} emptyKey="noPast" />
        </Box>
      </div>
    </>
  )
}
const Count = ({ n }: { n: number }) => <span className="rounded-full bg-slate-100 px-2 py-px text-[12px] font-semibold text-slate-600">{n}</span>

// ==================================================================== health
export function HealthView({ m }: { m: PatientModule }) {
  const { t } = useLang()
  return (
    <>
      <PageHead title={t.pHealth} icon={<HeartPulse size={20} />} />
      <div className="flex flex-col gap-4">
        <Box title={t.vitalsTitle} icon={<Activity size={18} />} right={<Count n={m.vitals.length} />}>
          {m.vitals.length ? (
            <div className="flex flex-col gap-3">
              {m.vitals.map((v) => (
                <div key={v.requestId} className="rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                  <div className="mb-2 flex flex-wrap items-center gap-x-2 text-[13px]">
                    <span className="font-bold text-slate-800">{dateTime(v.at)}</span>
                    <Link href={`/my/requests/${v.requestId}`} className="font-mono text-[12px] text-slate-400 hover:text-primary-700">
                      {v.requestNo}
                    </Link>
                    {v.values.some((x) => x.out) && (
                      <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#B91C1C]">
                        <AlertTriangle size={13} /> {t.outOfRange}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
                    {vitalTiles(v).map((x) => (
                      <div key={x.label} className={cx('rounded-lg bg-white px-2.5 py-1.5 ring-1', x.out ? 'ring-[#FECACA]' : 'ring-slate-100')}>
                        <div className="truncate text-[10.5px] font-semibold uppercase tracking-[.04em] text-slate-500">{x.label}</div>
                        <div className={cx('text-[15px] font-bold', x.out ? 'text-[#B91C1C]' : 'text-slate-900')}>
                          {x.value} <span className="text-[11px] font-medium text-slate-400">{x.unit}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>{t.noVitals}</Empty>
          )}
        </Box>
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <Box title={t.labsTitle} icon={<FlaskConical size={18} />} right={<Count n={m.labs.length} />}>
            {m.labs.length ? (
              <div className="divide-y divide-slate-100">
                {m.labs.map((l) => (
                  <div key={l.id} className="flex items-start gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">{l.test}</div>
                      <div className="text-[12px] text-slate-500">{[l.refRange && `Ref ${l.refRange}`, l.at && date(l.at)].filter(Boolean).join(' · ')}</div>
                      {l.summary && <div className="mt-0.5 text-[12.5px] text-slate-600">{l.summary}</div>}
                    </div>
                    <div className={cx('text-right text-[15px] font-bold', l.flag && l.flag !== 'NORMAL' ? 'text-[#B91C1C]' : 'text-slate-900')}>
                      {l.value} <span className="text-[11.5px] font-medium text-slate-400">{l.unit}</span>
                      {l.flag && l.flag !== 'NORMAL' && <div className="text-[11px] font-semibold">{l.flag}</div>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>{t.noLabs}</Empty>
            )}
          </Box>
          <Box title={t.medsTitle} icon={<Pill size={18} />} right={<Count n={m.medicines.length} />}>
            {m.medicines.length ? (
              <div className="divide-y divide-slate-100">
                {m.medicines.map((x, i) => (
                  <div key={i} className="flex items-start gap-3 py-2.5">
                    <span className="mt-0.5 flex size-8 flex-none items-center justify-center rounded-lg bg-[#F0FDFA] text-teal">
                      <Pill size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold">{x.drug}</div>
                      <div className="text-[12.5px] text-slate-500">{[x.dose, x.route, x.time].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="text-right text-[12px] text-slate-500">{x.at ? date(x.at) : ''}</div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty>{t.noMeds}</Empty>
            )}
          </Box>
        </div>
      </div>
    </>
  )
}

// ==================================================================== bills
export function BkashCard({ due }: { due: number }) {
  const { t } = useLang()
  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-[#E2136E] to-[#C2185B] p-4 text-white shadow-lg shadow-[#E2136E]/20">
      <div className="flex items-start gap-3">
        <a href="/pay/bkash-qr.jpg" target="_blank" rel="noreferrer" className="flex-none overflow-hidden rounded-xl bg-white p-1">
          <img src="/pay/bkash-qr.jpg" alt="bKash QR · Unico Hospitals" className="h-[118px] w-auto rounded-lg" />
        </a>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">{t.payBkash}</div>
          <div className="mt-0.5 text-[22px] font-bold leading-tight">{taka(due)}</div>
          <div className="mt-1 text-[12px] leading-[17px] text-white/85">{t.payBkashSub}</div>
        </div>
      </div>
    </section>
  )
}

export function BillsView({ m }: { m: PatientModule }) {
  const { t } = useLang()
  return (
    <>
      <PageHead title={t.billsTitle} icon={<Receipt size={20} />} />
      <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className={cx(card, '!p-4')}>
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">{t.totalPaid}</div>
              <div className="text-[22px] font-bold text-[#15803D]">{taka(m.counts.paid)}</div>
            </div>
            <div className={cx(card, '!p-4')}>
              <div className="text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">{t.totalDue}</div>
              <div className={cx('text-[22px] font-bold', m.counts.due > 0 ? 'text-[#B91C1C]' : 'text-slate-900')}>{m.counts.due > 0 ? taka(m.counts.due) : t.allPaid}</div>
            </div>
          </div>
          <Box title={t.billsTitle} icon={<Receipt size={18} />} right={<Count n={m.bills.length} />}>
            {m.bills.length ? (
              <div className="flex flex-col gap-2.5">
                {m.bills.map((b, i) => (
                  <div key={`${b.requestId}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14.5px] font-bold">
                        {t.invoice} {b.invoiceNo}
                      </div>
                      <div className="truncate text-[12.5px] text-slate-500">
                        {[b.date && date(b.date), b.service].filter(Boolean).join(' · ')}{' '}
                        <Link href={`/my/requests/${b.requestId}`} className="font-mono text-slate-400 hover:text-primary-700">
                          {b.requestNo}
                        </Link>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[15px] font-bold">{taka(b.payable)}</div>
                      <div className={cx('text-[12px] font-semibold', b.due > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]')}>{b.due > 0 ? `${t.totalDue} ${taka(b.due)}` : t.allPaid}</div>
                    </div>
                    {b.fileId && (
                      <a href={fileUrl(b.fileId)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-primary-700 ring-1 ring-slate-200 hover:bg-primary-50">
                        <FileText size={14} /> {t.viewBill}
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <Empty>{t.noBills}</Empty>
            )}
          </Box>
        </div>
        {m.counts.due > 0 && <BkashCard due={m.counts.due} />}
      </div>
    </>
  )
}

// ==================================================================== documents
export function DocsView({ m }: { m: PatientModule }) {
  const { t } = useLang()
  return (
    <>
      <PageHead title={t.docsTitle} icon={<FileText size={20} />} />
      <Box title={t.docsTitle} icon={<FileText size={18} />} right={<Count n={m.docs.length} />}>
        {m.docs.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {m.docs.map((d) => (
              <a key={d.id} href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="group flex items-center gap-3 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100 transition hover:bg-primary-50 hover:ring-primary/20">
                <span className={cx('flex size-11 flex-none items-center justify-center rounded-xl text-white', d.kind === 'INVOICE' ? 'bg-[#E2136E]' : d.kind === 'PRESCRIPTION' ? 'bg-teal' : 'bg-[#7C3AED]')}>
                  <FileText size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-bold uppercase tracking-[.04em] text-slate-500">{t.docKind[d.kind] ?? d.kind}</span>
                  <span className="block truncate text-[14px] font-semibold text-slate-900">{d.name}</span>
                  <span className="block text-[12px] text-slate-400">{[date(d.at), d.requestNo].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="text-[12.5px] font-semibold text-primary-700 opacity-0 transition group-hover:opacity-100">{t.open}</span>
              </a>
            ))}
          </div>
        ) : (
          <Empty>{t.noDocs}</Empty>
        )}
      </Box>
    </>
  )
}

// ==================================================================== repeating visits
export function SchedulesView({ m }: { m: PatientModule }) {
  const { t } = useLang()
  return (
    <>
      <PageHead title={t.schedulesTitle} icon={<Repeat size={20} />} />
      {m.schedules.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {m.schedules.map((s) => (
            <section key={s.id} className={card}>
              <div className="flex items-start gap-3">
                <span className="flex size-11 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-[#0EA5E9] to-[#0284C7] text-white">
                  <Repeat size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15.5px] font-bold">{s.title}</div>
                  <div className="text-[13.5px] font-semibold text-[#0369A1]">
                    {s.rule}
                    {s.time ? ` · ${clock(s.time)}` : ''}
                  </div>
                </div>
                <span className={cx('rounded-full px-2 py-0.5 text-[11px] font-bold', s.status === 'ACTIVE' ? 'bg-[#DCFCE7] text-[#15803D]' : s.status === 'PAUSED' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-slate-100 text-slate-500')}>{t.schedStatus[s.status] ?? s.status}</span>
              </div>
              <div className="mt-3 text-[13px] text-slate-600">{t.visitsDoneOf(s.done, s.total)}</div>
              {s.next.length > 0 && (
                <div className="mt-2.5">
                  <div className="mb-1 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-400">{t.nextVisits}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {s.next.map((x) => (
                      <Link key={x.id} href={`/my/requests/${x.id}`} className="rounded-full bg-primary-50 px-2.5 py-1 text-[12.5px] font-semibold text-primary-700 hover:bg-primary-100">
                        {relDay(x.at)} · {time(x.at)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          ))}
        </div>
      ) : (
        <Empty>{t.noSchedules}</Empty>
      )}
    </>
  )
}

// ==================================================================== one visit's records (its page)
export function VisitRecordsView({ v, due }: { v: import('@/lib/services/patient-module').VisitRecords; due: number }) {
  const { t } = useLang()
  if (!v.vitals && !v.medicines.length && !v.bills.length && !v.docs.length) return null
  return (
    <>
      {v.vitals && (
        <Box title={t.vitalsTitle} icon={<Activity size={18} />} right={<span className="text-[12.5px] text-slate-500">{dateTime(v.vitals.at)}</span>}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {vitalTiles(v.vitals).map((x) => (
              <div key={x.label} className={cx('rounded-xl px-3 py-2 ring-1', x.out ? 'bg-[#FEF2F2] ring-[#FECACA]' : 'bg-slate-50 ring-slate-100')}>
                <div className="truncate text-[11px] font-semibold uppercase tracking-[.04em] text-slate-500">{x.label}</div>
                <div className={cx('text-[16px] font-bold', x.out ? 'text-[#B91C1C]' : 'text-slate-900')}>
                  {x.value} <span className="text-[11.5px] font-medium text-slate-400">{x.unit}</span>
                </div>
              </div>
            ))}
          </div>
        </Box>
      )}
      {v.medicines.length > 0 && (
        <Box title={t.medsTitle} icon={<Pill size={18} />}>
          <div className="divide-y divide-slate-100">
            {v.medicines.map((x, i) => (
              <div key={i} className="py-2">
                <div className="text-[14px] font-semibold">{x.drug}</div>
                <div className="text-[12.5px] text-slate-500">{[x.dose, x.route, x.time].filter(Boolean).join(' · ')}</div>
              </div>
            ))}
          </div>
        </Box>
      )}
      {v.bills.length > 0 && (
        <Box title={t.billsTitle} icon={<Receipt size={18} />}>
          <div className="flex flex-col gap-2">
            {v.bills.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-slate-50 p-3 ring-1 ring-slate-100">
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-bold">
                    {t.invoice} {b.invoiceNo}
                  </div>
                  {b.date && <div className="text-[12px] text-slate-500">{date(b.date)}</div>}
                </div>
                <div className="text-right">
                  <div className="text-[15px] font-bold">{taka(b.payable)}</div>
                  <div className={cx('text-[12px] font-semibold', b.due > 0 ? 'text-[#B91C1C]' : 'text-[#15803D]')}>{b.due > 0 ? `${t.totalDue} ${taka(b.due)}` : t.allPaid}</div>
                </div>
                {b.fileId && (
                  <a href={fileUrl(b.fileId)} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-primary-700 ring-1 ring-slate-200 hover:bg-primary-50">
                    <FileText size={14} /> {t.viewBill}
                  </a>
                )}
              </div>
            ))}
          </div>
        </Box>
      )}
      {due > 0 && <BkashCard due={due} />}
      {v.docs.length > 0 && (
        <Box title={t.docsTitle} icon={<FileText size={18} />}>
          <div className="flex flex-col gap-2">
            {v.docs.map((d) => (
              <a key={d.id} href={fileUrl(d.id)} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-100 hover:bg-primary-50">
                <FileText size={18} className="flex-none text-[#7C3AED]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[11px] font-bold uppercase tracking-[.04em] text-slate-500">{t.docKind[d.kind] ?? d.kind}</span>
                  <span className="block truncate text-[13.5px] font-semibold">{d.name}</span>
                </span>
                <span className="text-[12.5px] font-semibold text-primary-700">{t.open}</span>
              </a>
            ))}
          </div>
        </Box>
      )}
    </>
  )
}
