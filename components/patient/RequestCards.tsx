'use client'
// Patient-facing request cards + progress timeline. Dates arrive pre-formatted from the server.
import Link from 'next/link'
import { CalendarPlus, ChevronRight, Phone, UserRound } from 'lucide-react'
import { STATUS_COLORS, type Status } from '@/lib/constants'
import { btnClass, telUrl } from '@/components/ui'
import { cx } from '@/lib/format'
import { useLang } from '@/components/public/i18n'

export type RequestCard = { id: string; requestNo: string; status: string; when: string; whenSub?: string; services: string[]; staff?: { name: string; role: string } | null; progress: number }
export type TimelineStep = { key: string; at?: string; sub?: string; state: 'done' | 'current' | 'todo' | 'skipped' | 'cancelled' }

export function StatusPill({ status, big }: { status: string; big?: boolean }) {
  const { t } = useLang()
  const [bg, fg] = STATUS_COLORS[status as Status] ?? STATUS_COLORS.NEW
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-bold', big ? 'h-8 px-3 text-[13px]' : 'h-6 px-2.5 text-[11.5px]')} style={{ background: bg, color: fg }}>
      <span className="size-1.5 rounded-full" style={{ background: fg }} /> {t.statusLabel[status] ?? status}
    </span>
  )
}

export function RequestList({ items, emptyKey }: { items: RequestCard[]; emptyKey: 'noCurrent' | 'noPast' }) {
  const { t } = useLang()
  if (!items.length)
    return (
      <div className="rounded-2xl p-6 text-center text-[14.5px] text-slate-500 hc-soft">
        {t[emptyKey]}
        <div className="mt-3">
          <Link href="/?book=1#book" className={btnClass('p', 'md')}>
            <CalendarPlus size={16} /> {t.ctaBook}
          </Link>
        </div>
      </div>
    )
  return (
    <div className="flex flex-col gap-3">
      {items.map((r) => (
        <Link key={r.id} href={`/my/requests/${r.id}`} className="group block rounded-2xl p-4 hc-soft transition hover:-translate-y-px">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill status={r.status} />
                <span className="font-mono text-[12px] text-slate-400">{r.requestNo}</span>
              </div>
              <div className="mt-2 text-[16px] font-bold leading-tight text-slate-900">{r.services.join(', ')}</div>
              <div className="mt-1 text-[13.5px] text-slate-600">
                {r.when}
                {r.whenSub && <span className="text-slate-400"> · {r.whenSub}</span>}
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-slate-500">
                <UserRound size={14} /> {r.staff ? `${r.staff.name} · ${r.staff.role}` : t.notAssigned}
              </div>
            </div>
            <ChevronRight size={20} className="mt-1 flex-none text-slate-300 group-hover:text-primary" />
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-gradient-to-r from-primary to-teal transition-all" style={{ width: `${Math.max(6, r.progress)}%` }} />
          </div>
        </Link>
      ))}
    </div>
  )
}

export function Timeline({ steps }: { steps: TimelineStep[] }) {
  const { t } = useLang()
  return (
    <ol className="relative ml-2 border-l-2 border-slate-200 pl-5">
      {steps.map((s) => {
        const tone = s.state === 'done' ? 'bg-[#16A34A] ring-[#DCFCE7]' : s.state === 'current' ? 'bg-primary ring-primary-50 animate-hcpulse' : s.state === 'cancelled' ? 'bg-[#DC2626] ring-[#FEE2E2]' : 'bg-slate-300 ring-white'
        return (
          <li key={s.key} className={cx('relative pb-5 last:pb-0', s.state === 'skipped' && 'opacity-50')}>
            <span className={cx('absolute -left-[27px] top-1 size-3.5 rounded-full ring-4', tone)} />
            <div className={cx('text-[14.5px] font-semibold', s.state === 'todo' || s.state === 'skipped' ? 'text-slate-400' : 'text-slate-900')}>{t.steps[s.key] ?? s.key}</div>
            {(s.at || s.sub) && <div className="text-[12.5px] text-slate-500">{[s.at, s.sub].filter(Boolean).join(' · ')}</div>}
          </li>
        )
      })}
    </ol>
  )
}

export function HelpBar({ hotline }: { hotline: string }) {
  const { t } = useLang()
  return (
    <a href={telUrl(hotline)} className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-navy to-primary p-4 text-white">
      <span className="flex size-11 flex-none items-center justify-center rounded-full bg-white/15">
        <Phone size={20} />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] text-white/80">{t.needHelp}</span>
        <span className="block text-[17px] font-bold">{hotline}</span>
      </span>
    </a>
  )
}

export function Greeting({ name }: { name: string }) {
  const { t } = useLang()
  return (
    <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">
      {t.hello}, {name}
    </div>
  )
}

export function SectionTitle({ k, count }: { k: 'current' | 'past' | 'team' | 'timeline' | 'myProfile'; count?: number }) {
  const { t } = useLang()
  return (
    <h2 className="mb-2.5 flex items-center gap-2 text-[17px] font-bold">
      {t[k]}
      {count != null && <span className="rounded-full bg-slate-100 px-2 py-px text-[12px] font-semibold text-slate-600">{count}</span>}
    </h2>
  )
}

export function NewRequestCta() {
  const { t } = useLang()
  return (
    <Link href="/?book=1#book" className="flex items-center gap-3 rounded-2xl bg-gradient-to-br from-primary to-teal p-4 text-white shadow-lg shadow-primary/25 transition hover:-translate-y-px">
      <span className="flex size-12 flex-none items-center justify-center rounded-full bg-white/20">
        <CalendarPlus size={24} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[17px] font-bold">{t.newRequest}</span>
        <span className="block text-[13px] text-white/85">{t.confirmByPhone}</span>
      </span>
      <ChevronRight size={22} className="text-white/80" />
    </Link>
  )
}
