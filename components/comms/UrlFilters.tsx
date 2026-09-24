'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { ChevronDown, Search, Loader2 } from 'lucide-react'
import { cx } from '@/lib/format'

/** Update URL search params (server components re-render with the new filters). `reset` params are dropped. */
export function useUrlParams(reset: string[] = ['id']) {
  const router = useRouter()
  const path = usePathname()
  const sp = useSearchParams()
  const [pending, start] = useTransition()
  const set = (patch: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams(sp.toString())
    for (const k of reset) q.delete(k)
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === '') q.delete(k)
      else q.set(k, v)
    }
    const s = q.toString()
    start(() => router.push(s ? `${path}?${s}` : path, { scroll: false }))
  }
  return { set, pending, sp }
}

/** Pill-looking dropdown ("Status: all ▾") that writes one URL param. */
export function UrlSelect({
  param,
  value,
  options,
  label,
  className,
  reset,
  tone,
}: {
  param: string
  value?: string | null
  options: { value: string; label: string }[]
  label?: string
  className?: string
  reset?: string[]
  tone?: 'red'
}) {
  const { set, pending } = useUrlParams(reset)
  const current = options.find((o) => o.value === (value ?? '')) ?? options[0]
  return (
    <label
      className={cx(
        'relative inline-flex h-[38px] flex-none cursor-pointer items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-[13px]',
        tone === 'red' ? 'border-[#FCA5A5] bg-[#FEF2F2] font-semibold text-[#B91C1C]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
        className,
      )}
    >
      <span>
        {label && <span>{label}: </span>}
        {current?.label}
      </span>
      {pending ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} className="text-slate-500" />}
      <select
        aria-label={label ?? param}
        className="absolute inset-0 cursor-pointer opacity-0"
        value={value ?? ''}
        onChange={(e) => set({ [param]: e.target.value })}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Search box writing `param` on Enter / blur. */
export function UrlSearch({ param = 'q', value, placeholder, className }: { param?: string; value?: string | null; placeholder?: string; className?: string }) {
  const { set, pending } = useUrlParams()
  const [v, setV] = useState(value ?? '')
  return (
    <form
      className={cx('flex h-[38px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[13px] focus-within:border-primary', className)}
      onSubmit={(e) => {
        e.preventDefault()
        set({ [param]: v.trim() })
      }}
    >
      {pending ? <Loader2 size={15} className="animate-spin text-slate-500" /> : <Search size={15} className="text-slate-500" />}
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== (value ?? '') && set({ [param]: v.trim() })} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" />
    </form>
  )
}

/** From / to date pair writing two params at once. */
export function UrlDateRange({ from, to, fromParam = 'from', toParam = 'to', icon }: { from?: string | null; to?: string | null; fromParam?: string; toParam?: string; icon?: ReactNode }) {
  const { set, pending } = useUrlParams()
  return (
    <div className="flex h-[38px] flex-none items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-[13px] text-slate-700">
      {pending ? <Loader2 size={15} className="animate-spin text-slate-500" /> : icon}
      <input type="date" aria-label="From" value={from ?? ''} onChange={(e) => set({ [fromParam]: e.target.value })} className="bg-transparent outline-none" />
      <span className="text-slate-400">–</span>
      <input type="date" aria-label="To" value={to ?? ''} onChange={(e) => set({ [toParam]: e.target.value })} className="bg-transparent outline-none" />
    </div>
  )
}
