'use client'
// Pick store items with quantities (loans, receiving): search by name, size or company; a family's sizes come as
// picture chips with stock; each picked line has − / qty / +.
import { useMemo, useState } from 'react'
import { Minus, Plus, Search, X } from 'lucide-react'
import { cx } from '@/lib/format'
import { groupItems } from '@/lib/store-groups'

export type PickItem = { _id: string; name: string; unit: string; stock?: number; family?: string; variant?: string; brand?: string; isActive?: boolean; imageId?: string | null }
export type Line = { itemId: string; qty: number }

export function Thumb({ item, size = 28 }: { item: PickItem; size?: number }) {
  return (
    <span className="flex flex-none items-center justify-center overflow-hidden rounded-md bg-slate-100 text-[9px] text-slate-400" style={{ width: size, height: size }}>
      {item.imageId ? <img src={`/api/v1/equipment/${item._id}/image?v=${item.imageId}`} alt="" className="size-full object-cover" loading="lazy" /> : '—'}
    </span>
  )
}

/** `out`: these items leave the store (warn when more than in stock) · `in`: they come in (show the new total). */
export function ItemPicker({ items, lines, setLines, mode, autoFocus }: { items: PickItem[]; lines: Line[]; setLines: (f: (l: Line[]) => Line[]) => void; mode: 'out' | 'in'; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
  const byId = (id: string) => items.find((i) => i._id === id)
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const found = items.filter((c) => c.isActive !== false && !lines.some((l) => l.itemId === c._id) && words.every((w) => [c.name, c.family, c.variant, c.brand].some((f) => (f ?? '').toLowerCase().includes(w))))
    return groupItems(found).slice(0, 8)
  }, [q, items, lines])
  const add = (id: string) => {
    setLines((x) => [...x, { itemId: id, qty: 1 }])
    setQ('')
  }
  const setQty = (id: string, v: number) => setLines((x) => x.map((l) => (l.itemId === id ? { ...l, qty: Math.max(1, Math.min(100000, v || 1)) } : l)))
  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <label className="relative block">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="hc-input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add item — name, size or company (e.g. cannula 22G)" autoFocus={autoFocus} />
        </label>
        {!!hits.length && (
          <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-[340px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {hits.map((g) =>
              g.members.length === 1 ? (
                <li key={g.members[0]._id}>
                  <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-slate-50" onClick={() => add(g.members[0]._id)}>
                    <Thumb item={g.members[0]} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{g.members[0].name}</span>
                    <span className="text-[12px] text-slate-500">
                      {g.members[0].stock ?? 0} {g.members[0].unit} in store
                    </span>
                  </button>
                </li>
              ) : (
                <li key={g.family} className="px-3 py-2">
                  <div className="mb-1.5 text-[14px] font-semibold">
                    {g.family} <span className="text-[12px] font-normal text-slate-500">· pick the size</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.members.map((c) => (
                      <button key={c._id} type="button" onClick={() => add(c._id)} title={c.name} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 py-1 pl-1 pr-2.5 text-[13px] hover:border-primary">
                        <Thumb item={c} />
                        <b>{c.variant || c.name}</b>
                        {c.brand && <span className="text-[11.5px] text-slate-500">{c.brand}</span>}
                        <span className="rounded bg-slate-200 px-1 text-[11.5px] font-bold">{c.stock ?? 0}</span>
                      </button>
                    ))}
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
      </div>
      <ul className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-lg ring-1 ring-slate-200">
        {!lines.length && <li className="px-4 py-6 text-center text-[13px] text-slate-500">No items yet — search above.</li>}
        {lines.map((l) => {
          const c = byId(l.itemId)
          const have = c?.stock ?? 0
          const over = mode === 'out' && have < l.qty
          return (
            <li key={l.itemId} className="flex items-center gap-2.5 px-3 py-2.5">
              {c && <Thumb item={c} size={36} />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14px] font-semibold">{c?.name ?? 'Item'}</div>
                <div className={cx('text-[12px]', over ? 'font-semibold text-[#B45309]' : 'text-slate-500')}>
                  {have} {c?.unit} in store{mode === 'out' ? (over ? ' — more than in stock' : ` → ${have - l.qty} left`) : ` → ${have + l.qty} after`}
                </div>
              </div>
              <button type="button" onClick={() => setQty(l.itemId, l.qty - 1)} className="flex size-8 items-center justify-center rounded-lg border border-slate-300" aria-label="One less">
                <Minus size={14} />
              </button>
              <input className="hc-input h-8 w-16 px-2 text-center" inputMode="numeric" value={l.qty} onChange={(e) => setQty(l.itemId, Number(e.target.value.replace(/\D/g, '')))} aria-label="Quantity" />
              <button type="button" onClick={() => setQty(l.itemId, l.qty + 1)} className="flex size-8 items-center justify-center rounded-lg bg-primary text-white" aria-label="One more">
                <Plus size={14} />
              </button>
              <button type="button" onClick={() => setLines((x) => x.filter((y) => y.itemId !== l.itemId))} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:text-[#B91C1C]" aria-label="Remove">
                <X size={15} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
