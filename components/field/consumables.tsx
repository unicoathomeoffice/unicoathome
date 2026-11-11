'use client'
// "Consumables used" on a visit: pre-filled with the service's usual use (Settings → Services → Bag & consumables);
// staff adjust with − / + and add anything else from the catalog. Feeds the consumables report, and saving takes the
// used quantity out of the store (lib/services/stock.ts) — "in store" shows what is left.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Minus, Plus, Search } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { ItemPicture } from '@/components/admin-settings/EquipmentEditor'
import { cx } from '@/lib/format'
import { groupItems } from '@/lib/store-groups'

export type CatalogRow = { _id: string; name: string; unit: string; imageId?: string | null; stock?: number; family?: string; variant?: string; brand?: string }
type Line = { itemId: string; qty: number }

export function ConsumablesEditor({ requestId, catalog, initial, editable, back, big = true }: { requestId: string; catalog: CatalogRow[]; initial: Line[]; editable: boolean; back?: string; big?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [lines, setLines] = useState<Line[]>(initial)
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const byId = (id: string) => catalog.find((c) => c._id === id)
  const dirty = JSON.stringify(lines) !== JSON.stringify(initial)
  // search by item, family, size or company ("cannula 22", "braun"); a family's sizes come back as one row of chips
  const hits = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) return []
    const found = catalog.filter((c) => !lines.some((l) => l.itemId === c._id) && words.every((w) => [c.name, c.family, c.variant, c.brand].some((f) => (f ?? '').toLowerCase().includes(w))))
    return groupItems(found).slice(0, 8)
  }, [q, catalog, lines])
  const add = (id: string) => {
    setLines((x) => [...x, { itemId: id, qty: 1 }])
    setQ('')
  }
  // what the store can still give this visit: its stock plus what this visit already took (saved before)
  const avail = (id: string) => {
    const st = byId(id)?.stock
    return st == null ? null : st + (initial.find((l) => l.itemId === id)?.qty ?? 0)
  }
  const setQty = (id: string, d: number) => setLines((x) => x.map((l) => (l.itemId === id ? { ...l, qty: Math.max(0, Math.min(999, l.qty + d)) } : l)))

  async function save() {
    setBusy(true)
    try {
      await api(`/requests/${requestId}/consumables`, { method: 'PUT', body: { items: lines } })
      toast('Consumables saved', 'ok')
      if (back) router.push(back)
      else router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        {!lines.length && <li className="px-4 py-6 text-center text-[13.5px] text-slate-500">Nothing recorded yet — add what you used below.</li>}
        {lines.map((l) => {
          const c = byId(l.itemId)
          return (
            <li key={l.itemId} className={cx('flex items-center gap-3 px-4', big ? 'py-3' : 'py-2.5', l.qty === 0 && 'opacity-50')}>
              <ItemPicture item={{ _id: l.itemId, imageId: c?.imageId, name: c?.name ?? '' }} size={big ? 52 : 40} />
              <div className="min-w-0 flex-1">
                <div className={cx('font-semibold text-slate-800', big ? 'text-[15px]' : 'text-[14px]')}>{c?.name ?? 'Item'}</div>
                <div className="text-[12px] text-slate-500">
                  per {c?.unit ?? 'pcs'}
                  {l.qty === 0 ? ' · not used (removed on save)' : ''}
                  {avail(l.itemId) != null && (
                    <span className={cx(l.qty > (avail(l.itemId) ?? 0) ? 'font-semibold text-[#B45309]' : '')}>
                      {' · '}
                      {Math.max(0, (avail(l.itemId) ?? 0) - l.qty)} left in store{l.qty > (avail(l.itemId) ?? 0) ? ` (only ${Math.max(0, avail(l.itemId) ?? 0)} were in store)` : ''}
                    </span>
                  )}
                </div>
              </div>
              {editable ? (
                <span className="flex flex-none items-center gap-1.5">
                  <button type="button" disabled={l.qty <= 0} onClick={() => setQty(l.itemId, -1)} className={cx('flex items-center justify-center rounded-lg border-[1.5px] border-slate-300 text-slate-700 disabled:opacity-40', big ? 'size-11' : 'size-8')} aria-label={`One less ${c?.name}`}>
                    <Minus size={16} />
                  </button>
                  <span className={cx('w-9 text-center font-bold tabular-nums', big ? 'text-[18px]' : 'text-[15px]')}>{l.qty}</span>
                  <button type="button" onClick={() => setQty(l.itemId, 1)} className={cx('flex items-center justify-center rounded-lg bg-primary text-white', big ? 'size-11' : 'size-8')} aria-label={`One more ${c?.name}`}>
                    <Plus size={16} />
                  </button>
                </span>
              ) : (
                <span className="flex-none text-[15px] font-bold tabular-nums">× {l.qty}</span>
              )}
            </li>
          )
        })}
      </ul>
      {editable && (
        <div className="relative">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={cx('hc-input pl-9', big && 'hc-input-lg')} value={q} onChange={(e) => setQ(e.target.value)} placeholder={catalog.length ? 'Add another item — type to search' : 'No consumables in the catalog yet'} disabled={!catalog.length} />
          </label>
          {!!hits.length && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {hits.map((g) =>
                g.members.length === 1 ? (
                  <li key={g.members[0]._id}>
                    <button type="button" className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left text-[14px] hover:bg-slate-50" onClick={() => add(g.members[0]._id)}>
                      <ItemPicture item={g.members[0]} size={34} />
                      <span className="min-w-0 flex-1 truncate font-semibold">{g.members[0].name}</span>
                      <span className={cx('text-[12px]', g.members[0].stock != null && g.members[0].stock <= 0 ? 'font-semibold text-[#B91C1C]' : 'text-slate-500')}>{g.members[0].stock != null ? `${g.members[0].stock} ${g.members[0].unit} in store` : g.members[0].unit}</span>
                    </button>
                  </li>
                ) : (
                  <li key={g.family} className="px-3 py-2">
                    <div className="mb-1.5 flex items-center gap-2 text-[14px] font-semibold">
                      <ItemPicture item={g.members[0]} size={28} /> {g.family}
                      <span className="text-[12px] font-normal text-slate-500">· pick the size</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.members.map((c) => {
                        const out = c.stock != null && c.stock <= 0
                        return (
                          <button key={c._id} type="button" onClick={() => add(c._id)} title={c.name} className={cx('inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-[13px]', out ? 'border-[#FECACA] bg-[#FEF2F2] text-slate-500' : 'border-slate-200 bg-slate-50 hover:border-primary')}>
                            <b className="text-slate-900">{c.variant || c.name}</b>
                            {c.brand && <span className="text-[11.5px] text-slate-500">{c.brand}</span>}
                            {c.stock != null && <span className={cx('rounded px-1 text-[11.5px] font-bold', out ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-[#DCFCE7] text-[#15803D]')}>{c.stock}</span>}
                          </button>
                        )
                      })}
                    </div>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
      {editable && (
        <button type="button" disabled={busy || (!dirty && initial.length > 0)} onClick={save} className={cx('flex items-center justify-center gap-2 rounded-xl bg-primary font-bold text-white disabled:opacity-50', big ? 'h-[52px] text-[16px]' : 'h-10 text-sm')}>
          {busy && <Loader2 size={18} className="animate-spin" />} Save consumables
        </button>
      )}
    </div>
  )
}
