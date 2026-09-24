'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ChevronDown, Search, X } from 'lucide-react'
import { cx } from '@/lib/format'

/** Update one or more query params (removing empty ones and resetting page). */
export function useQueryUpdater() {
  const router = useRouter()
  const path = usePathname()
  const sp = useSearchParams()
  return (patch: Record<string, string | undefined | null>) => {
    const next = new URLSearchParams(sp.toString())
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    const qs = next.toString()
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false })
  }
}

/** Pill-shaped select showing "Label: value" (design filter buttons), backed by a native <select>. */
export function FilterSelect({ label, param, options, allLabel = 'all', className }: { label: string; param: string; options: { value: string; label: string }[]; allLabel?: string; className?: string }) {
  const sp = useSearchParams()
  const update = useQueryUpdater()
  const value = sp.get(param) ?? ''
  const current = options.find((o) => o.value === value)?.label ?? allLabel
  return (
    <label className={cx('relative inline-flex h-10 flex-none cursor-pointer items-center gap-2 rounded-lg border bg-white pl-3 pr-2.5 text-[13px]', value ? 'border-primary text-primary-700' : 'border-slate-300 text-slate-700', className)}>
      <span className="whitespace-nowrap">
        <span className={value ? 'font-semibold' : 'text-slate-500'}>{label}:</span> <span className="font-semibold">{current}</span>
      </span>
      <ChevronDown size={15} className="text-slate-500" />
      <select aria-label={label} value={value} onChange={(e) => update({ [param]: e.target.value })} className="absolute inset-0 cursor-pointer opacity-0">
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** Debounced search box bound to ?q= */
export function SearchBox({ placeholder, param = 'q', className }: { placeholder: string; param?: string; className?: string }) {
  const sp = useSearchParams()
  const update = useQueryUpdater()
  const [v, setV] = useState(sp.get(param) ?? '')
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    const t = setTimeout(() => update({ [param]: v.trim() || undefined }), 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v])
  return (
    <div className={cx('flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm focus-within:border-primary', className)}>
      <Search size={17} className="flex-none text-slate-500" />
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" />
      {v && (
        <button type="button" onClick={() => setV('')} className="text-slate-400 hover:text-slate-600" aria-label="Clear search">
          <X size={15} />
        </button>
      )}
    </div>
  )
}
