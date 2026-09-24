'use client'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { ChevronDown, Columns3, Download, Loader2, Search, Table2, X } from 'lucide-react'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import type { BoardRow, Option } from './types'
import { downloadCsv } from './csv'

type Select = { key: string; label: string; options: Option[] }

/** Filter bar for the requests board: view toggle, filter selects and search — all stored in the URL. */
export function BoardFilters({ view, selects, canCreate, rows }: { view: 'kanban' | 'table'; selects: Select[]; canCreate: boolean; rows: BoardRow[] }) {
  const router = useRouter()
  const path = usePathname()
  const params = useSearchParams()
  const [pending, start] = useTransition()
  const [q, setQ] = useState(params.get('q') ?? '')
  useEffect(() => setQ(params.get('q') ?? ''), [params])

  const hrefWith = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString())
    for (const [k, v] of Object.entries(patch)) v ? p.set(k, v) : p.delete(k)
    const s = p.toString()
    return s ? `${path}?${s}` : path
  }
  const set = (patch: Record<string, string | null>) => start(() => router.replace(hrefWith(patch), { scroll: false }))
  const WIDTH: Record<string, number> = { status: 108, priority: 108, service: 108, staff: 100, zone: 100, date: 104 }
  const active = selects.some((s) => params.get(s.key)) || !!params.get('q')

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-slate-300" role="group" aria-label="View">
        {(
          [
            ['kanban', 'Kanban', Columns3],
            ['table', 'Table', Table2],
          ] as const
        ).map(([k, label, Icon]) => (
          <Link
            key={k}
            href={hrefWith({ view: k === 'table' ? 'table' : null })}
            scroll={false}
            className={cx('flex h-9 items-center gap-1.5 px-3.5 text-[13px] font-semibold', view === k ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 hover:bg-slate-50')}
          >
            <Icon size={15} />
            {label}
          </Link>
        ))}
      </div>

      {selects.map((s) => {
        const v = params.get(s.key) ?? ''
        return (
          <label key={s.key} style={{ width: WIDTH[s.key] ?? 112 }} className={cx('relative flex h-9 flex-none items-center rounded-lg border bg-white pl-3 pr-7 text-[13px]', v ? 'border-primary text-primary-700' : 'border-slate-300 text-slate-700')}>
            <span className="sr-only">{s.label}</span>
            <select value={v} onChange={(e) => set({ [s.key]: e.target.value || null })} className="w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent outline-none">
              {s.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {s.key === 'date' ? o.label : o.value ? `${s.label}: ${o.label}` : `${s.label}: all`}
                </option>
              ))}
            </select>
            <ChevronDown size={15} className="pointer-events-none absolute right-2 text-slate-500" />
          </label>
        )
      })}

      <form
        onSubmit={(e) => {
          e.preventDefault()
          set({ q: q.trim() || null })
        }}
        className="flex h-9 w-[120px] items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] focus-within:border-primary"
      >
        <Search size={15} className="flex-none text-slate-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400" aria-label="Search requests" />
      </form>

      {active && (
        <button type="button" onClick={() => set(Object.fromEntries([...selects.map((s) => [s.key, null]), ['q', null]]))} className="inline-flex h-9 items-center gap-1 px-1 text-[13px] font-semibold text-slate-500 hover:text-slate-800">
          <X size={14} /> Clear
        </button>
      )}
      {pending && <Loader2 size={16} className="animate-spin text-slate-400" />}

      <div className="ml-auto flex gap-2">
        <button type="button" className={btnClass('o')} onClick={() => downloadCsv(rows)} disabled={!rows.length}>
          <Download size={16} /> Export
        </button>
      </div>
    </div>
  )
}
