// Presentational building blocks (server-safe: no hooks). Values mirror ui/design/gen/helpers.js.
import Link from 'next/link'
import { Clock } from 'lucide-react'
import type { ReactNode } from 'react'
import { STATUS_COLORS, STATUS_LABEL, type Status, type Priority } from '@/lib/constants'
import { cx, initialsOf } from '@/lib/format'

// ---------------------------------------------------------------- chips & badges
export function StatusChip({ status, sm, label }: { status: Status | string; sm?: boolean; label?: string }) {
  const [bg, fg, dot] = STATUS_COLORS[status as Status] ?? STATUS_COLORS.NEW
  return (
    <span
      className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-bold uppercase tracking-[.02em]', sm ? 'h-[22px] px-2 text-[10.5px]' : 'h-6 px-2.5 text-[11px]')}
      style={{ background: bg, color: fg }}
    >
      <span className={cx('size-1.5 rounded-full', status === 'IN_PROGRESS' && 'animate-hcpulse')} style={{ background: dot }} />
      {label ?? STATUS_LABEL[status as Status] ?? status}
    </span>
  )
}

export function PriorityBadge({ priority }: { priority: Priority | string }) {
  if (priority === 'ROUTINE')
    return <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full border border-slate-300 px-2 text-[10.5px] font-bold text-slate-600">ROUTINE</span>
  if (priority === 'URGENT') return <span className="inline-flex h-[22px] items-center whitespace-nowrap rounded-full bg-[#F59E0B] px-2 text-[10.5px] font-bold text-white">URGENT</span>
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full bg-[#DC2626] px-2 text-[10.5px] font-bold text-white">
      <span className="size-1.5 animate-hcpulse rounded-full bg-white" />
      EMERGENCY
    </span>
  )
}

const SLA_TONE = { g: 'bg-[#DCFCE7] text-[#15803D]', a: 'bg-[#FEF3C7] text-[#B45309]', r: 'bg-[#FEE2E2] text-[#B91C1C]' } as const
export function SlaPill({ tone, label }: { tone: 'g' | 'a' | 'r' | string; label: string }) {
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', SLA_TONE[tone as 'g'] ?? SLA_TONE.g)}>
      <Clock size={12} strokeWidth={2.5} />
      {label}
    </span>
  )
}

const TAG_TONE = {
  slate: 'bg-slate-100 text-slate-600',
  blue: 'bg-primary-50 text-primary-700',
  green: 'bg-[#DCFCE7] text-[#15803D]',
  amber: 'bg-[#FEF3C7] text-[#B45309]',
  red: 'bg-[#FEE2E2] text-[#B91C1C]',
  violet: 'bg-[#EDE9FE] text-[#6D28D9]',
  indigo: 'bg-[#E0E7FF] text-[#4338CA]',
  orange: 'bg-[#FFEDD5] text-[#C2410C]',
  navy: 'bg-navy text-white',
  dark: 'bg-slate-900 text-white',
} as const
export type Tone = keyof typeof TAG_TONE
/** Small rounded label: "Skill ✓", "Zone ✓", "PAID", etc. */
export function Tag({ children, tone = 'slate', className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11px] font-bold', TAG_TONE[tone], className)}>{children}</span>
}

// ---------------------------------------------------------------- avatar
const AV_TONE = {
  blue: 'bg-primary-50 text-primary-700',
  teal: 'bg-teal text-white',
  navy: 'bg-navy text-white',
  slate: 'bg-slate-100 text-slate-600',
  amber: 'bg-[#FEF3C7] text-[#B45309]',
  violet: 'bg-[#EDE9FE] text-[#6D28D9]',
  green: 'bg-[#DCFCE7] text-[#15803D]',
} as const
export function Avatar({ name, initials, size = 40, tone = 'blue', className }: { name?: string | null; initials?: string; size?: number; tone?: keyof typeof AV_TONE; className?: string }) {
  return (
    <div className={cx('flex flex-none items-center justify-center rounded-full font-bold', AV_TONE[tone], className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
      {initials ?? initialsOf(name)}
    </div>
  )
}

// ---------------------------------------------------------------- surfaces
export function Card({ children, className, pad = true, as: As = 'div' }: { children: ReactNode; className?: string; pad?: boolean; as?: 'div' | 'section' }) {
  return <As className={cx('rounded-card bg-white shadow-card', pad && 'p-5', className)}>{children}</As>
}

export function CardHeader({ title, sub, right, className }: { title: ReactNode; sub?: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-4 flex items-start gap-3', className)}>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold">{title}</div>
        {sub && <div className="mt-0.5 text-[13px] text-slate-500">{sub}</div>}
      </div>
      {right}
    </div>
  )
}

/** Uppercase section label (13px, slate-500, tracked) */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('text-[12px] font-semibold uppercase tracking-[.06em] text-slate-500', className)}>{children}</div>
}

export function Kpi({ n, label, color = '#0F172A', sub, dense, href }: { n: ReactNode; label: string; color?: string; sub?: ReactNode; dense?: boolean; href?: string }) {
  const body = (
    <div className={cx('min-w-0 rounded-card bg-white shadow-card transition', dense ? 'px-3.5 py-3' : 'px-5 py-[18px]', href && 'hover:ring-2 hover:ring-primary/20')}>
      <div className={cx('truncate font-semibold uppercase tracking-[.05em] text-slate-500', dense ? 'text-[11px]' : 'text-[12px]')}>{label}</div>
      <div className={cx('font-bold leading-[1.1]', dense ? 'mt-0.5 text-2xl' : 'mt-1.5 text-[32px]')} style={{ color }}>
        {n}
      </div>
      {sub && <div className={cx('text-[12px] text-slate-500', dense ? 'mt-0.5' : 'mt-1.5')}>{sub}</div>}
    </div>
  )
  return href ? <Link href={href}>{body}</Link> : body
}

// ---------------------------------------------------------------- charts (CSS bars, as in the design)
export function Bars({ values, labels = [], height = 140, color = '#0090CA', highlightLast = true }: { values: number[]; labels?: string[]; height?: number; color?: string; highlightLast?: boolean }) {
  const max = Math.max(1, ...values)
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {values.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${labels[i] ?? ''}: ${v}`}>
          <div className="w-full rounded-t" style={{ height: Math.max(2, Math.round((v / max) * (height - 22))), background: highlightLast && i === values.length - 1 ? color : '#BEE3F2' }} />
          <div className="whitespace-nowrap text-[10px] text-slate-400">{labels[i] ?? ''}</div>
        </div>
      ))}
    </div>
  )
}

export function HBars({ items, color = '#0090CA', labelWidth = 150 }: { items: [string, number][]; color?: string; labelWidth?: number }) {
  const max = Math.max(1, ...items.map((i) => i[1]))
  if (!items.length) return <div className="py-4 text-center text-[13px] text-slate-400">No data yet</div>
  return (
    <div className="flex flex-col gap-2.5">
      {items.map(([l, v]) => (
        <div key={l} className="flex items-center gap-3 text-[13px]">
          <div className="truncate text-slate-700" style={{ width: labelWidth }}>
            {l}
          </div>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full" style={{ width: `${Math.round((v / max) * 100)}%`, background: color }} />
          </div>
          <div className="w-8 text-right font-bold">{v}</div>
        </div>
      ))}
    </div>
  )
}

export function Progress({ value, max, color = '#0090CA', className }: { value: number; max: number; color?: string; className?: string }) {
  return (
    <div className={cx('h-2 overflow-hidden rounded-full bg-slate-100', className)}>
      <div className="h-full rounded-full transition-all" style={{ width: `${max ? Math.min(100, Math.round((value / max) * 100)) : 0}%`, background: color }} />
    </div>
  )
}

// ---------------------------------------------------------------- buttons
const BTN = {
  p: 'bg-primary text-white hover:bg-primary-700',
  o: 'border-[1.5px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  s: 'bg-primary-50 text-primary-700 hover:bg-primary-100',
  g: 'bg-[#16A34A] text-white hover:bg-[#15803D]',
  r: 'border-[1.5px] border-[#FCA5A5] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]',
  rf: 'bg-[#DC2626] text-white hover:bg-[#B91C1C]',
  k: 'bg-slate-900 text-white hover:bg-slate-800',
  d: 'bg-slate-300 text-white cursor-not-allowed',
  ghost: 'text-slate-600 hover:bg-slate-100',
} as const
export type BtnKind = keyof typeof BTN
const SIZE = { sm: 'h-8 px-3 text-[13px] rounded-lg', md: 'h-[38px] px-3.5 text-sm rounded-lg', lg: 'h-12 px-5 text-base rounded-xl', xl: 'h-[52px] px-5 text-base rounded-xl' } as const
export const btnClass = (kind: BtnKind = 'p', size: keyof typeof SIZE = 'md', extra?: string) =>
  cx('inline-flex flex-none select-none items-center justify-center gap-2 whitespace-nowrap font-semibold transition disabled:opacity-50', SIZE[size], size === 'lg' || size === 'xl' ? 'font-bold' : '', BTN[kind], extra)

export function LinkButton({ href, children, kind = 'p', size = 'md', className, target }: { href: string; children: ReactNode; kind?: BtnKind; size?: keyof typeof SIZE; className?: string; target?: string }) {
  return (
    <Link href={href} className={btnClass(kind, size, className)} target={target}>
      {children}
    </Link>
  )
}

export function IconLink({ href, children, title, className }: { href: string; children: ReactNode; title?: string; className?: string }) {
  return (
    <Link href={href} title={title} className={cx('inline-flex size-8 flex-none items-center justify-center rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50', className)}>
      {children}
    </Link>
  )
}

// ---------------------------------------------------------------- tabs (link based)
export function Tabs({ items, active, className }: { items: { key: string; label: ReactNode; href: string; count?: number }[]; active: string; className?: string }) {
  return (
    <div className={cx('no-scrollbar flex gap-1 overflow-x-auto border-b border-slate-200', className)}>
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          scroll={false}
          className={cx('-mb-px flex h-10 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm font-semibold', t.key === active ? 'border-b-2 border-primary text-primary-700' : 'text-slate-500 hover:text-slate-700')}
        >
          {t.label}
          {t.count != null && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  )
}

/** Pill filter chips (dark = active) */
export function Chips({ items, active, className }: { items: { key: string; label: ReactNode; href: string }[]; active?: string; className?: string }) {
  return (
    <div className={cx('no-scrollbar flex gap-2 overflow-x-auto', className)}>
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          scroll={false}
          className={cx('inline-flex h-8 flex-none items-center gap-1 rounded-full px-3 text-[13px] font-semibold', i.key === active ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white text-slate-700')}
        >
          {i.label}
        </Link>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- tables
/** Grid-based table matching the design: header 44px #F8FAFC, uppercase 11.5px. `cols` = CSS grid template. */
export function Table({ cols, head, children, className, empty }: { cols: string; head: ReactNode[]; children: ReactNode; className?: string; empty?: ReactNode }) {
  const hasRows = Array.isArray(children) ? children.flat().filter(Boolean).length > 0 : !!children
  return (
    <div className={cx('overflow-hidden rounded-card bg-white shadow-card', className)}>
      <div className="overflow-x-auto">
        <div className="min-w-fit">
          <div className="grid h-11 items-center border-b border-slate-200 bg-slate-50 px-5 text-[11.5px] font-bold uppercase tracking-[.05em] text-slate-500" style={{ gridTemplateColumns: cols }}>
            {head.map((h, i) => (
              <div key={i} className="truncate pr-3">
                {h}
              </div>
            ))}
          </div>
          {hasRows ? children : <div className="px-5 py-12 text-center text-sm text-slate-400">{empty ?? 'Nothing here yet'}</div>}
        </div>
      </div>
    </div>
  )
}

export function Tr({ cols, children, href, className, selected }: { cols: string; children: ReactNode; href?: string; className?: string; selected?: boolean }) {
  const cls = cx('grid min-h-14 items-center border-t border-slate-100 px-5 py-2 text-sm first:border-t-0', href && 'hover:bg-slate-50', selected && 'bg-primary-50', className)
  const inner = Array.isArray(children) ? children.map((c, i) => <div key={i} className="min-w-0 pr-3">{c}</div>) : children
  return href ? (
    <Link href={href} className={cls} style={{ gridTemplateColumns: cols }}>
      {inner}
    </Link>
  ) : (
    <div className={cls} style={{ gridTemplateColumns: cols }}>
      {inner}
    </div>
  )
}

// ---------------------------------------------------------------- misc
export function Empty({ icon, title, sub, action }: { icon?: ReactNode; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      {icon && <div className="mb-1 flex size-14 items-center justify-center rounded-full bg-primary-50 text-primary">{icon}</div>}
      <div className="text-[15px] font-bold">{title}</div>
      {sub && <div className="max-w-sm text-[13px] text-slate-500">{sub}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

/** Key/value row for detail cards */
export function KV({ k, v, className }: { k: ReactNode; v: ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-start justify-between gap-4 py-1.5 text-sm', className)}>
      <div className="text-slate-500">{k}</div>
      <div className="text-right font-semibold text-slate-900">{v ?? '—'}</div>
    </div>
  )
}

/** Toggle visual (use components/client/Toggle for an interactive one) */
export function ToggleView({ on }: { on: boolean }) {
  return (
    <div className={cx('relative h-8 w-[52px] flex-none rounded-full transition', on ? 'bg-primary' : 'bg-slate-300')}>
      <div className={cx('absolute top-[3px] size-[26px] rounded-full bg-white shadow transition-all', on ? 'right-[3px]' : 'left-[3px]')} />
    </div>
  )
}

/** Map placeholder with grid lines (as in the design; real maps open Google Maps) */
export function MapBox({ height = 160, note, children, href }: { height?: number; note?: string; children?: ReactNode; href?: string }) {
  const box = (
    <div
      className="relative overflow-hidden rounded-card bg-[#E5EEF2]"
      style={{ height, backgroundImage: 'linear-gradient(rgba(15,23,42,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(15,23,42,.06) 1px,transparent 1px)', backgroundSize: '28px 28px' }}
    >
      {children}
      {note && <div className="absolute bottom-2.5 left-3 rounded-md bg-white/85 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{note}</div>}
    </div>
  )
  return href ? (
    <a href={href} target="_blank" rel="noreferrer">
      {box}
    </a>
  ) : (
    box
  )
}

export function MapPin({ n, x, y, color = '#0090CA' }: { n: ReactNode; x: number; y: number; color?: string }) {
  return (
    <div className="absolute flex size-[26px] items-center justify-center shadow-md" style={{ left: `${x}%`, top: `${y}%`, borderRadius: '50% 50% 50% 0', transform: 'translate(-50%,-100%) rotate(-45deg)', background: color }}>
      <span className="text-xs font-bold text-white" style={{ transform: 'rotate(45deg)' }}>
        {n}
      </span>
    </div>
  )
}

export const mapsUrl = (address?: string | null, lat?: number | null, lng?: number | null) =>
  lat != null && lng != null ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address ?? ''}, Dhaka`)}`
export const telUrl = (p?: string | null) => `tel:${(p ?? '').replace(/[^\d+]/g, '')}`
