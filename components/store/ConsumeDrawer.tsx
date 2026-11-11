'use client'
// Manual consumption (store admins): several items at once with a reason — like H360's Department Consumption, kept in
// HomeCare. Sizes of a family are picked as chips (IV cannula → 22G · B Braun). Saving takes them out of the store.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Minus, PackageMinus, Plus, Search, X } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { groupItems } from '@/lib/store-groups'

export type ConsumeItem = { _id: string; name: string; unit: string; stock?: number; family?: string; variant?: string; brand?: string; isActive?: boolean }

export const REASONS = [
  ['CLINIC', 'Used in clinic / OPD'],
  ['PATIENT', 'Given to a patient'],
  ['WASTAGE', 'Wastage / damaged'],
  ['EXPIRED', 'Expired'],
  ['TRANSFER', 'Transfer to another department'],
  ['OTHER', 'Other'],
] as const

const nowLocal = () => {
  const d = new Date(Date.now() + 6 * 3600_000) // Dhaka wall clock for the datetime-local input
  return d.toISOString().slice(0, 16)
}

export function ConsumeDrawer({ items, preset = [], onClose }: { items: ConsumeItem[]; preset?: string[]; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [lines, setLines] = useState<{ itemId: string; qty: number }[]>(preset.map((itemId) => ({ itemId, qty: 1 })))
  const [q, setQ] = useState('')
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('CLINIC')
  const [requestNo, setRequestNo] = useState('')
  const [note, setNote] = useState('')
  const [at, setAt] = useState(nowLocal())
  const [busy, setBusy] = useState(false)
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

  async function save() {
    if (!lines.length) return toast('Add at least one item', 'err')
    setBusy(true)
    try {
      const r = await api<{ no: string; short: string[] }>('/store/consumptions', {
        body: { items: lines, reason, requestNo: requestNo.trim() || undefined, note: note.trim() || undefined, at: new Date(`${at}:00+06:00`).toISOString() },
      })
      toast(`${r.no} saved · ${lines.length} item${lines.length === 1 ? '' : 's'} taken out of the store${r.short.length ? ` · more than in stock: ${r.short.join(', ')}` : ''}`, r.short.length ? 'err' : 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title="Consume from store"
      sub="Take items out by hand — used in clinic, wastage, expired… (also enter it in H360 Department Consumption)"
      width={520}
      footer={
        <>
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={busy || !lines.length} className={btnClass('p')} onClick={save}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <PackageMinus size={16} />} Consume {lines.reduce((a, l) => a + l.qty, 0) || ''}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="relative">
          <label className="relative block">
            <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="hc-input pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add item — name, size or company (e.g. cannula 22G)" autoFocus={!preset.length} />
          </label>
          {!!hits.length && (
            <ul className="absolute inset-x-0 top-full z-10 mt-1 max-h-[340px] overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {hits.map((g) =>
                g.members.length === 1 ? (
                  <li key={g.members[0]._id}>
                    <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-[14px] hover:bg-slate-50" onClick={() => add(g.members[0]._id)}>
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
                        <button key={c._id} type="button" onClick={() => add(c._id)} title={c.name} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-[13px] hover:border-primary">
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
            const over = c && (c.stock ?? 0) < l.qty
            return (
              <li key={l.itemId} className="flex items-center gap-2.5 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-semibold">{c?.name ?? 'Item'}</div>
                  <div className={cx('text-[12px]', over ? 'font-semibold text-[#B45309]' : 'text-slate-500')}>
                    {c?.stock ?? 0} {c?.unit} in store{over ? ' — more than in stock' : ` → ${(c?.stock ?? 0) - l.qty} left`}
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

        <div>
          <span className="hc-label">Reason *</span>
          <div className="grid grid-cols-2 gap-1.5">
            {REASONS.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setReason(k)} className={cx('h-10 rounded-lg border px-2 text-[13px] font-semibold', reason === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hc-label">When</span>
            <input type="datetime-local" className="hc-input" value={at} max={nowLocal()} onChange={(e) => setAt(e.target.value)} />
          </label>
          <label>
            <span className="hc-label">Visit (optional)</span>
            <input className="hc-input" value={requestNo} onChange={(e) => setRequestNo(e.target.value)} placeholder="HC-261111-0001" />
          </label>
        </div>
        <label>
          <span className="hc-label">Note</span>
          <input className="hc-input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="e.g. dressing in OPD, broken pack, H360 consumption no." />
        </label>
      </div>
    </Drawer>
  )
}
