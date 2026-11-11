'use client'
// Store → Add item: from H360's item list, from H360's Family Medicine store (items not here yet), as a copy of one of
// our items (a new size of a family), or many at once by paste / CSV. Everything lands in one "to add" list that can
// be checked and changed before saving. Duplicates (same H360 code or name) are flagged.
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardPaste, Copy, Database, FilePlus2, Loader2, PackagePlus, Search, Store, Trash2, Upload } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { parseItemName } from '@/lib/store-groups'

type Existing = { _id: string; name: string; unit: string; type: 'EQUIPMENT' | 'CONSUMABLE'; h360Code?: string; family?: string; variant?: string; brand?: string; imageId?: string | null; alertBelow?: number; tolerance?: number }
type Draft = { k: string; name: string; unit: string; type: 'EQUIPMENT' | 'CONSUMABLE'; h360Code: string; family: string; variant: string; brand: string; stock: string; copyFrom?: string; source: 'H360' | 'COPY' | 'BULK' | 'MANUAL'; alertBelow?: number; tolerance?: number }
type Tab = 'h360' | 'store' | 'copy' | 'bulk'

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
const newKey = () => Math.random().toString(36).slice(2, 9)
const EQUIP_RX = /machine|monitor|scale|stethoscope|nebuli[sz]er|thermometer|oximeter|glucometer|scissor|stapler|box|bag|tray|forceps|kidney dish|bp\b/i

function draftFrom(name: string, extra: Partial<Draft> = {}): Draft {
  const p = parseItemName(name)
  return { k: newKey(), name, unit: 'pcs', type: EQUIP_RX.test(name) ? 'EQUIPMENT' : 'CONSUMABLE', h360Code: '', family: p.family, variant: p.variant, brand: p.brand, stock: '0', source: 'MANUAL', ...extra }
}

/** CSV / pasted rows → drafts. A header row (name, unit, code, type, stock, family, size, company) sets the columns. */
function parseRows(text: string): Draft[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (!lines.length) return []
  const sep = lines[0].includes('\t') ? '\t' : ','
  const split = (l: string) => {
    const out: string[] = []
    let cur = ''
    let q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === sep && !q) (out.push(cur.trim()), (cur = ''))
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  const first = split(lines[0]).map((h) => h.toLowerCase())
  const hasHead = first.some((h) => /^(name|item|item name)$/.test(h))
  const col = (re: RegExp, fallback: number) => {
    const i = first.findIndex((h) => re.test(h))
    return hasHead ? i : fallback
  }
  const c = { name: col(/name|item/, 0), unit: col(/unit|uom/, 1), code: col(/code|h360/, 2), type: col(/type/, 3), stock: col(/stock|qty|opening/, 4), family: col(/family|group/, -1), size: col(/size|variant/, -1), brand: col(/company|brand|maker/, -1) }
  return (hasHead ? lines.slice(1) : lines)
    .map(split)
    .filter((r) => (r[c.name] ?? '').length >= 2)
    .map((r) => {
      const get = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '')
      const d = draftFrom(get(c.name), { source: 'BULK' })
      return {
        ...d,
        unit: get(c.unit) || 'pcs',
        h360Code: get(c.code),
        type: /equip/i.test(get(c.type)) ? 'EQUIPMENT' : /consum/i.test(get(c.type)) ? 'CONSUMABLE' : d.type,
        stock: String(Number(get(c.stock).replace(/[^\d-]/g, '')) || 0),
        family: get(c.family) || d.family,
        variant: get(c.size) || d.variant,
        brand: get(c.brand) || d.brand,
      }
    })
}

export function AddItemChooser({ items, onClose, onBlank, preset }: { items: Existing[]; onClose: () => void; onBlank?: () => void; preset?: { tab: Tab; copyFrom?: string } }) {
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>(preset?.tab ?? 'h360')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [busy, setBusy] = useState(false)
  // H360 item list
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<{ code: string; name: string; uom: string; type: string; generic: string; inStore: boolean }[] | null>(null)
  const [hErr, setHErr] = useState<string | null>(null)
  // H360 Family Medicine store: not here yet
  const [missing, setMissing] = useState<{ code: string; name: string; uom: string; stock: number }[] | null>(null)
  const [pickMissing, setPickMissing] = useState<Set<string>>(new Set())
  // copy
  const [copyQ, setCopyQ] = useState('')
  // bulk
  const [bulk, setBulk] = useState('')

  const names = useMemo(() => new Set(items.map((i) => norm(i.name))), [items])
  const codes = useMemo(() => new Set(items.map((i) => i.h360Code).filter(Boolean) as string[]), [items])
  const dupOf = (d: Draft) => (d.h360Code && codes.has(d.h360Code) ? 'H360 code already in the store' : names.has(norm(d.name)) ? 'Same name already in the store' : drafts.filter((x) => x !== d && norm(x.name) === norm(d.name)).length ? 'Twice in this list' : null)

  useEffect(() => {
    if (tab !== 'h360') return
    const term = q.trim()
    if (term.length < 2) return setHits(null)
    let live = true
    const t = setTimeout(() => {
      api<{ items: any[]; error?: string }>(`/store/h360-items?q=${encodeURIComponent(term)}`)
        .then((r) => live && (setHits(r.items), setHErr(r.error ?? null)))
        .catch((e) => live && (setHits([]), setHErr(e.message)))
    }, 350)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, tab])
  useEffect(() => {
    if (tab !== 'store' || missing) return
    api<{ items: any[]; error?: string }>('/store/h360-missing')
      .then((r) => (setMissing(r.items), setHErr(r.error ?? null)))
      .catch((e) => (setMissing([]), setHErr(e.message)))
  }, [tab, missing])
  useEffect(() => {
    if (preset?.copyFrom) copyItem(items.find((i) => i._id === preset.copyFrom))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function copyItem(src?: Existing) {
    if (!src) return
    setDrafts((x) => [
      ...x,
      { k: newKey(), name: `${src.name} (copy)`, unit: src.unit, type: src.type, h360Code: '', family: src.family ?? '', variant: '', brand: src.brand ?? '', stock: '0', copyFrom: src._id, source: 'COPY', alertBelow: src.alertBelow, tolerance: src.tolerance },
    ])
    toast('Copied — change the name and size below', 'ok')
  }
  const upd = (k: string, p: Partial<Draft>) => setDrafts((x) => x.map((d) => (d.k === k ? { ...d, ...p } : d)))

  async function saveDrafts() {
    const ok = drafts.filter((d) => d.name.trim().length >= 2 && !dupOf(d))
    if (!ok.length) return toast('Nothing new to add — check the names', 'err')
    setBusy(true)
    try {
      const r = await api<{ added: { name: string }[]; skipped: { name: string; why: string }[] }>('/store/items', {
        body: { items: ok.map((d) => ({ name: d.name.trim(), unit: d.unit.trim() || 'pcs', type: d.type, h360Code: d.h360Code.trim() || undefined, family: d.family.trim() || undefined, variant: d.variant.trim() || undefined, brand: d.brand.trim() || undefined, stock: Number(d.stock) || 0, copyFrom: d.copyFrom, source: d.source, alertBelow: d.alertBelow, tolerance: d.tolerance })) },
      })
      toast(`${r.added.length} item${r.added.length === 1 ? '' : 's'} added${r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped[0].why})` : ''}`, r.added.length ? 'ok' : 'err')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  async function addMissing() {
    if (!pickMissing.size) return
    setBusy(true)
    try {
      const r = await api<{ added?: string[] }>('/store/h360', { body: { action: 'add', codes: [...pickMissing] } })
      toast(`${r.added?.length ?? 0} item(s) added with their H360 stock`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const TABS: [Tab, string, any][] = [
    ['h360', 'H360 item list', Database],
    ['store', 'H360 Family Medicine store', Store],
    ['copy', 'Copy an item', Copy],
    ['bulk', 'Paste / CSV', ClipboardPaste],
  ]
  const copyHits = copyQ.trim() ? items.filter((i) => [i.name, i.family, i.variant, i.brand].some((f) => (f ?? '').toLowerCase().includes(copyQ.trim().toLowerCase()))).slice(0, 12) : items.slice(0, 12)

  return (
    <Drawer
      open
      onClose={onClose}
      title="Add items to the store"
      sub="From H360, as a copy of one of ours, or many at once — check them below, then add"
      width={720}
      footer={
        tab === 'store' ? (
          <>
            <button type="button" className={btnClass('o')} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnClass('p')} disabled={busy || !pickMissing.size} onClick={addMissing}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Add {pickMissing.size || ''} with H360 stock
            </button>
          </>
        ) : (
          <>
            {onBlank && (
              <button type="button" className={btnClass('ghost', 'md', 'mr-auto')} onClick={onBlank}>
                <FilePlus2 size={16} /> Blank form
              </button>
            )}
            <button type="button" className={btnClass('o')} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnClass('p')} disabled={busy || !drafts.length} onClick={saveDrafts}>
              {busy ? <Loader2 size={16} className="animate-spin" /> : <PackagePlus size={16} />} Add {drafts.filter((d) => !dupOf(d)).length || ''} item{drafts.length === 1 ? '' : 's'}
            </button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {TABS.map(([k, label, Icon]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={cx('flex h-11 items-center justify-center gap-1.5 rounded-lg border px-2 text-[12.5px] font-semibold', tab === k ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')}>
              <Icon size={15} /> {label}
            </button>
          ))}
        </div>
        {hErr && <div className="rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">H360: {hErr}</div>}

        {tab === 'h360' && (
          <div>
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="hc-input pl-9" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search H360 items — name or code (e.g. cannula, gauze, 26898373)" />
            </label>
            {q.trim().length >= 2 && !hits && <Loader2 size={16} className="mt-2 animate-spin text-slate-400" />}
            {!!hits?.length && (
              <ul className="mt-2 max-h-[300px] divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
                {hits.map((h) => {
                  const added = drafts.some((d) => d.h360Code === h.code)
                  return (
                    <li key={h.code + h.name} className="flex items-center gap-2 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-semibold">{h.name}</div>
                        <div className="text-[11.5px] text-slate-500">{[h.code, h.uom, h.type, h.generic].filter(Boolean).join(' · ')}</div>
                      </div>
                      {h.inStore ? (
                        <span className="text-[12px] font-semibold text-slate-400">In store</span>
                      ) : (
                        <button type="button" disabled={added} className={btnClass('o', 'sm')} onClick={() => setDrafts((x) => [...x, draftFrom(h.name, { h360Code: h.code, unit: h.uom || 'pcs', source: 'H360' })])}>
                          {added ? 'Added below' : '+ Add'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {hits && !hits.length && q.trim().length >= 2 && <div className="mt-2 text-[12.5px] text-slate-500">Nothing found in H360.</div>}
          </div>
        )}

        {tab === 'store' && (
          <div>
            {!missing ? (
              <div className="flex items-center gap-2 text-[13px] text-slate-500">
                <Loader2 size={16} className="animate-spin" /> Reading the H360 Family Medicine store…
              </div>
            ) : !missing.length ? (
              <div className="rounded-lg bg-[#F0FDF4] px-3 py-3 text-[13px] font-semibold text-[#15803D]">Every item of the H360 Family Medicine store is already here.</div>
            ) : (
              <ul className="max-h-[360px] divide-y divide-slate-100 overflow-y-auto rounded-lg ring-1 ring-slate-200">
                {missing.map((m) => (
                  <li key={m.code}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2">
                      <input type="checkbox" className="size-4 accent-[#0090CA]" checked={pickMissing.has(m.code)} onChange={(e) => setPickMissing((s) => { const n = new Set(s); if (e.target.checked) n.add(m.code); else n.delete(m.code); return n })} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold">{m.name}</span>
                        <span className="text-[11.5px] text-slate-500">
                          {m.code} · {m.stock} {m.uom} in H360
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {tab === 'copy' && (
          <div>
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className="hc-input pl-9" value={copyQ} onChange={(e) => setCopyQ(e.target.value)} placeholder="Find the item to copy (e.g. cannula 22G)" />
            </label>
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {copyHits.map((i) => (
                <button key={i._id} type="button" onClick={() => copyItem(i)} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-left hover:border-primary">
                  <span className="flex size-9 flex-none items-center justify-center overflow-hidden rounded-md bg-slate-100 text-[9px] text-slate-400">{i.imageId ? <img src={`/api/v1/equipment/${i._id}/image?v=${i.imageId}`} alt="" className="size-full object-cover" /> : '—'}</span>
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{i.name}</span>
                  <Copy size={14} className="text-slate-400" />
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-[12px] text-slate-500">The copy keeps the family, company, unit, type, picture and alert level — change the name and size.</div>
          </div>
        )}

        {tab === 'bulk' && (
          <div className="flex flex-col gap-2">
            <textarea
              className="hc-input min-h-[130px] font-mono text-[12.5px]"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={'One item per line — name, unit, H360 code, type, opening stock\nIV cannula Safety 16G (B Braun), pcs, 26898370, consumable, 10\nGauze swab 10x10, pcs, , consumable, 50\n(or paste rows from Excel; a header row with name / unit / code / stock / family / size / company works too)'}
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" className={btnClass('o', 'sm')} disabled={!bulk.trim()} onClick={() => { const rows = parseRows(bulk); setDrafts((x) => [...x, ...rows]); setBulk(''); toast(`${rows.length} row(s) ready below`, rows.length ? 'ok' : 'err') }}>
                <ClipboardPaste size={14} /> Read rows
              </button>
              <label className={btnClass('o', 'sm', 'cursor-pointer')}>
                <Upload size={14} /> CSV file
                <input
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    const rows = parseRows(await f.text())
                    setDrafts((x) => [...x, ...rows])
                    toast(`${rows.length} row(s) read from ${f.name}`, rows.length ? 'ok' : 'err')
                  }}
                />
              </label>
              <button type="button" className={btnClass('ghost', 'sm')} onClick={() => setDrafts((x) => [...x, draftFrom('', { source: 'MANUAL' })])}>
                + Empty row
              </button>
            </div>
          </div>
        )}

        {tab !== 'store' && (
          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[13px] font-bold">To add · {drafts.length}</span>
              {drafts.length > 0 && (
                <button type="button" className="text-[12px] font-semibold text-slate-500 hover:text-[#B91C1C]" onClick={() => setDrafts([])}>
                  Clear
                </button>
              )}
            </div>
            {!drafts.length ? (
              <div className="rounded-lg border border-dashed border-slate-300 px-4 py-6 text-center text-[12.5px] text-slate-500">Pick items above — they appear here to check before adding.</div>
            ) : (
              <div className="flex flex-col gap-2">
                {drafts.map((d) => {
                  const dup = dupOf(d)
                  return (
                    <div key={d.k} className={cx('rounded-lg p-2.5 ring-1', dup ? 'bg-[#FEF2F2] ring-[#FECACA]' : 'bg-slate-50 ring-slate-200')}>
                      <div className="flex gap-1.5">
                        <input className="hc-input h-9 flex-1 font-semibold" value={d.name} onChange={(e) => upd(d.k, { name: e.target.value })} placeholder="Item name" />
                        <button type="button" className="flex size-9 items-center justify-center rounded-lg text-slate-400 hover:text-[#B91C1C]" onClick={() => setDrafts((x) => x.filter((y) => y.k !== d.k))} aria-label="Remove">
                          <Trash2 size={15} />
                        </button>
                      </div>
                      <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        <input className="hc-input h-8 text-[12.5px]" value={d.family} onChange={(e) => upd(d.k, { family: e.target.value })} placeholder="Family" />
                        <input className="hc-input h-8 text-[12.5px]" value={d.variant} onChange={(e) => upd(d.k, { variant: e.target.value })} placeholder="Size" />
                        <input className="hc-input h-8 text-[12.5px]" value={d.brand} onChange={(e) => upd(d.k, { brand: e.target.value })} placeholder="Company" />
                        <input className="hc-input h-8 text-[12.5px]" value={d.h360Code} onChange={(e) => upd(d.k, { h360Code: e.target.value })} placeholder="H360 code" />
                        <input className="hc-input h-8 text-[12.5px]" value={d.unit} onChange={(e) => upd(d.k, { unit: e.target.value })} placeholder="Unit" />
                        <select className="hc-input h-8 text-[12.5px]" value={d.type} onChange={(e) => upd(d.k, { type: e.target.value as Draft['type'] })} aria-label="Type">
                          <option value="CONSUMABLE">Consumable</option>
                          <option value="EQUIPMENT">Equipment</option>
                        </select>
                        <label className="col-span-2 flex items-center gap-1.5 text-[12.5px] text-slate-600">
                          Opening stock
                          <input className="hc-input h-8 w-24 text-[12.5px]" inputMode="numeric" value={d.stock} onChange={(e) => upd(d.k, { stock: e.target.value.replace(/[^\d-]/g, '') })} />
                        </label>
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11.5px]">
                        <span className="rounded bg-white px-1.5 font-semibold text-slate-500 ring-1 ring-slate-200">{{ H360: 'from H360', COPY: 'copy', BULK: 'paste / CSV', MANUAL: 'by hand' }[d.source]}</span>
                        {dup && <span className="font-semibold text-[#B91C1C]">{dup} — will be skipped</span>}
                        {!dup && (
                          <button type="button" className="ml-auto font-semibold text-primary-700 hover:underline" onClick={() => upd(d.k, parseItemName(d.name))}>
                            Suggest family · size · company
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
