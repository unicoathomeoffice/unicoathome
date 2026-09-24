// Server-safe building blocks shared by the coordinator / transport / shared mobile screens.
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '@/lib/format'

/** Form label as in the mobile design: 13px semibold slate-700, red asterisk, optional right hint */
export function FLabel({ children, req, hint, className }: { children: ReactNode; req?: boolean; hint?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-1.5 flex items-baseline justify-between gap-2', className)}>
      <div className="text-[13px] font-semibold text-slate-700">
        {children}
        {req && <span className="text-[#DC2626]"> *</span>}
      </div>
      {hint && <div className="text-[12px] text-slate-500">{hint}</div>}
    </div>
  )
}

/** Section title (uppercase 13px, tracked) */
export function SLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('mt-1 flex items-center justify-between gap-2', className)}>
      <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">{children}</div>
      {right && <div className="text-[12px] text-slate-500">{right}</div>}
    </div>
  )
}

const ABTN = {
  p: 'bg-primary text-white active:bg-primary-700',
  s: 'bg-primary-50 text-primary-700 active:bg-primary-100',
  o: 'border-[1.5px] border-slate-300 bg-white text-slate-700 active:bg-slate-50',
  g: 'bg-[#16A34A] text-white active:bg-[#15803D]',
  r: 'border-[1.5px] border-[#FCA5A5] bg-white text-[#B91C1C] active:bg-[#FEF2F2]',
  k: 'bg-slate-900 text-white',
  soft: 'bg-slate-100 text-primary-700 active:bg-slate-200',
} as const
export type AKind = keyof typeof ABTN
/** Card action button (40px, radius 12, 14px bold) — design `btn` inside cards */
export const abtn = (kind: AKind = 'p', extra?: string) =>
  cx('inline-flex h-10 select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3.5 text-sm font-bold transition disabled:opacity-50', ABTN[kind], extra)

/** Big bottom-bar button (52px) */
export const bbtn = (kind: AKind = 'p', extra?: string) =>
  cx('inline-flex h-[52px] select-none items-center justify-center gap-2 whitespace-nowrap rounded-xl px-5 text-base font-bold transition disabled:opacity-50', ABTN[kind], extra)

export function ALink({ href, kind = 'p', className, children }: { href: string; kind?: AKind; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={abtn(kind, className)}>
      {children}
    </Link>
  )
}

/** Segmented control made of links (server) — design `seg` */
export function SegLinks({ items, active, h = 36 }: { items: { key: string; label: ReactNode; href: string }[]; active: string; h?: number }) {
  return (
    <div className="flex gap-[3px] rounded-[10px] bg-slate-200 p-[3px]">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          scroll={false}
          replace
          className={cx('flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2 text-sm font-semibold', i.key === active ? 'bg-white text-slate-900 shadow-[0_1px_3px_rgba(15,23,42,.1)]' : 'text-slate-500')}
          style={{ height: h }}
        >
          {i.label}
        </Link>
      ))}
    </div>
  )
}

/** Small stat tile (design: KPI in mobile, 20px number + 11px label) */
export function MiniKpi({ n, label, color = '#0F172A', href, active }: { n: ReactNode; label: string; color?: string; href?: string; active?: boolean }) {
  const body = (
    <div className={cx('min-w-0 rounded-card bg-white px-2.5 py-2.5 shadow-card', active && 'ring-[1.5px] ring-[#F97316]')}>
      <div className="text-[20px] font-bold leading-6" style={{ color }}>
        {n}
      </div>
      <div className="overflow-hidden whitespace-nowrap text-[11px] tracking-[-.01em] text-slate-500">{label}</div>
    </div>
  )
  return href ? (
    <Link href={href} className="min-w-0 flex-1">
      {body}
    </Link>
  ) : (
    <div className="min-w-0 flex-1">{body}</div>
  )
}

/** "Signed in as" header (S4 / D1) */
export function SignedInHeader({ initials, name, sub, right, tone = 'orange' }: { initials: string; name: string; sub: ReactNode; right?: ReactNode; tone?: 'orange' | 'blue' }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-5 pb-3.5 pt-[max(14px,env(safe-area-inset-top))]">
      <div className={cx('flex size-11 flex-none items-center justify-center rounded-full text-base font-bold', tone === 'orange' ? 'bg-[#FFEDD5] text-[#C2410C]' : 'bg-primary-50 text-primary-700')}>{initials}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-slate-500">Signed in as</div>
        <div className="truncate text-[17px] font-bold leading-[22px]">{name}</div>
        <div className="truncate text-[12px] text-slate-500">{sub}</div>
      </div>
      {right}
    </header>
  )
}

/** Score colour used on candidate cards */
export const scoreColor = (s: number) => (s >= 80 ? '#15803D' : s >= 50 ? '#C2410C' : '#64748B')

/** Short staff name: "Dr Abdur Rashid" → "Abdur Rashid"; "Nasif Ahammed Niloy" → "Nasif A. Niloy" */
export function shortName(n?: string | null) {
  if (!n) return ''
  const parts = n.replace(/^(Md\.?|Mst\.?)\s+/i, '').split(/\s+/).filter(Boolean)
  if (parts.length <= 2) return parts.join(' ')
  const dr = /^Dr\.?$/i.test(parts[0])
  const core = dr ? parts.slice(1) : parts
  if (core.length <= 2) return (dr ? 'Dr ' : '') + core.join(' ')
  return (dr ? 'Dr ' : '') + `${core[0]} ${core[1][0]}. ${core[core.length - 1]}`
}

export const genderShort = (g?: string | null) => (g === 'M' || g === 'F' ? g : g === 'O' ? 'O' : '')
export const ageG = (age?: number | null, g?: string | null) => [age != null ? String(age) : '', genderShort(g)].filter(Boolean).join(' ')

/** Bottom action bar for client forms (fixed to the phone column; leaves a spacer in the flow). */
export function FixedBottom({ children, note, spacer = true }: { children: ReactNode; note?: ReactNode; spacer?: boolean }) {
  return (
    <>
      {spacer && <div className={note ? 'h-[104px]' : 'h-[76px]'} aria-hidden />}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-[480px] border-t border-slate-200 bg-white px-5 pb-[max(16px,env(safe-area-inset-bottom))] pt-3">
        {note && <div className="mb-2 text-center text-[12px] font-semibold text-[#B45309]">{note}</div>}
        <div className="flex gap-2.5">{children}</div>
      </div>
    </>
  )
}

/** Selectable pill chip (design: 38px, primary when on, with check) */
export function chipClass(on: boolean, extra?: string) {
  return cx('inline-flex h-[38px] items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition', on ? 'bg-primary text-white' : 'border border-slate-300 bg-white text-slate-700', extra)
}
