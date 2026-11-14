'use client'
// The store's "Items & stock" view: colourful overview tiles, a tidy toolbar, and every item — single or a family of
// sizes — as the same clean product card, organized in sections (equipment · consumables; low / out via the tiles), a plain
// A–Z family grid, or a compact list. Families open inline with their sizes. State, drawers and the item editor stay in
// components/admin-settings/EquipmentEditor.tsx; this file only shows things and calls back.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Boxes,
  Camera,
  ChevronDown,
  ChevronUp,
  Images,
  LayoutGrid,
  List,
  Minus,
  Package,
  PackageMinus,
  PackagePlus,
  Pencil,
  Plus,
  Search,
  Stethoscope,
  Syringe,
  X,
} from 'lucide-react'
import { Toggle } from '@/components/client'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'
import { groupItems, stockState } from '@/lib/store-groups'
import { pictureCount } from './ImageViewer'
import type { EquipmentDoc } from '@/components/admin-settings/EquipmentEditor'

type Item = EquipmentDoc
type View = 'cards' | 'families' | 'list'
type TypeFilter = 'ALL' | 'CONSUMABLE' | 'EQUIPMENT' | 'LOW'

const imgUrl = (i: Item) => (i.imageId ? `/api/v1/equipment/${i._id}/image?v=${i.imageId}` : null)
const TONE = {
  ok: { badge: 'bg-[#DCFCE7] text-[#15803D] ring-[#BBF7D0]', bar: 'bg-[#22C55E]', chip: 'bg-[#F0FDF4] text-[#166534] ring-[#BBF7D0]' },
  low: { badge: 'bg-[#FEF3C7] text-[#B45309] ring-[#FDE68A]', bar: 'bg-[#F59E0B]', chip: 'bg-[#FFFBEB] text-[#92400E] ring-[#FDE68A]' },
  out: { badge: 'bg-[#FEE2E2] text-[#B91C1C] ring-[#FECACA]', bar: 'bg-[#EF4444]', chip: 'bg-[#FEF2F2] text-[#991B1B] ring-[#FECACA]' },
} as const
const worst = (ms: Item[]) => (ms.some((m) => stockState(m) === 'out') ? 'out' : ms.some((m) => stockState(m) === 'low') ? 'low' : 'ok')
const initials = (s: string) =>
  s
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
const remember = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key)
    return v ? (JSON.parse(v) as T) : fallback
  } catch {
    return fallback
  }
}
const save = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}

// ================================================================ picture
function Picture({ item, className, onClick, big = true }: { item: Item; className?: string; onClick?: () => void; big?: boolean }) {
  const src = imgUrl(item)
  const equip = item.type === 'EQUIPMENT'
  const body = src ? (
    <img src={src} alt={item.name} loading="lazy" className="size-full object-contain p-[8%] transition duration-300 group-hover/pic:scale-[1.06]" />
  ) : (
    <span className={cx('flex size-full flex-col items-center justify-center gap-1', equip ? 'bg-gradient-to-br from-[#EEF2FF] to-[#E0E7FF] text-[#4F46E5]' : 'bg-gradient-to-br from-[#F0F9FF] to-[#E0F2FE] text-[#0284C7]')}>
      <span className={cx('font-bold tracking-wide opacity-80', big ? 'text-[26px]' : 'text-[15px]')}>{initials(item.family || item.name).replace(/[^A-Z]/g, '') || <Package size={big ? 30 : 18} />}</span>
      {big && onClick && (
        <span className="flex items-center gap-1 text-[11px] font-semibold opacity-0 transition group-hover/pic:opacity-90">
          <Camera size={12} /> Add photo
        </span>
      )}
    </span>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className={cx('group/pic relative block overflow-hidden bg-white', className)} title={src ? 'View pictures' : 'Add a picture'}>
      {body}
    </button>
  ) : (
    <span className={cx('group/pic relative block overflow-hidden bg-white', className)}>{body}</span>
  )
}

function StockBar({ item, unit }: { item: { stock?: number; alertBelow?: number }; unit: string }) {
  const st = stockState(item)
  const n = Math.max(0, item.stock ?? 0)
  const ref = Math.max(n, (item.alertBelow ?? 0) * 3, 10)
  return (
    <div className="flex items-center gap-2">
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
        <span className={cx('block h-full rounded-full transition-all', TONE[st].bar)} style={{ width: `${n ? Math.max(6, (n / ref) * 100) : 0}%` }} />
      </span>
      <span className={cx('flex-none text-[12px] font-bold tabular-nums', st === 'out' ? 'text-[#B91C1C]' : st === 'low' ? 'text-[#B45309]' : 'text-slate-700')}>
        {item.stock ?? 0} <span className="font-medium text-slate-400">{unit}</span>
      </span>
    </div>
  )
}

function TypePill({ type }: { type: Item['type'] }) {
  return type === 'EQUIPMENT' ? (
    <span className="rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#4338CA]">Equipment</span>
  ) : (
    <span className="rounded-full bg-[#E0F2FE] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#0369A1]">Consumable</span>
  )
}

type Actions = {
  canStock: boolean
  onOpen: (i: Item) => void
  onPicture: (i: Item) => void
  onConsume: (ids: string[]) => void
  onReceive: (ids: string[]) => void
}

// ================================================================ cards
function ProductCard({ i, a, compact = false, sizeLabel = false }: { i: Item; a: Actions; compact?: boolean; sizeLabel?: boolean }) {
  const st = stockState(i)
  const pics = pictureCount(i)
  return (
    <div className={cx('group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,.06)] ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-8px_rgba(15,23,42,.18)] hover:ring-primary/40', !i.isActive && 'opacity-55')}>
      <div className="relative">
        <Picture item={i} onClick={() => a.onPicture(i)} big={!compact} className="aspect-square w-full border-b border-slate-100" />
        <span className={cx('pointer-events-none absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11.5px] font-bold shadow-sm ring-1', TONE[st].badge)}>{st === 'out' ? 'Out' : i.stock ?? 0}</span>
        {pics > 1 && (
          <span className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-0.5 rounded-full bg-slate-900/65 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
            <Images size={10} /> {pics}
          </span>
        )}
        {!i.isActive && <span className="pointer-events-none absolute left-2 top-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10.5px] font-bold text-white">Hidden</span>}
        {a.canStock && (
          <span className="absolute bottom-2 right-2 flex gap-1 transition sm:translate-y-1 sm:opacity-0 sm:group-hover:translate-y-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
            <button type="button" onClick={() => a.onConsume([i._id])} className="flex size-8 items-center justify-center rounded-full bg-white text-[#B91C1C] shadow-md ring-1 ring-slate-200 hover:bg-red-50" title="Consume" aria-label={`Consume ${i.name}`}>
              <Minus size={15} strokeWidth={2.6} />
            </button>
            <button type="button" onClick={() => a.onReceive([i._id])} className="flex size-8 items-center justify-center rounded-full bg-white text-[#15803D] shadow-md ring-1 ring-slate-200 hover:bg-emerald-50" title="Receive" aria-label={`Receive ${i.name}`}>
              <Plus size={15} strokeWidth={2.6} />
            </button>
          </span>
        )}
      </div>
      <button type="button" onClick={() => a.onOpen(i)} className={cx('flex flex-1 flex-col gap-1.5 text-left', compact ? 'p-2.5' : 'p-3')}>
        <span className={cx('line-clamp-2 font-semibold leading-snug text-slate-900', compact ? 'min-h-[2.5em] text-[12.5px]' : 'min-h-[2.6em] text-[13.5px]')} title={i.name}>
          {sizeLabel ? i.variant || i.name : i.name}
        </span>
        {!compact && (
          <span className="flex min-h-[20px] flex-wrap items-center gap-1.5">
            <TypePill type={i.type} />
            {i.brand && <span className="truncate text-[11.5px] font-medium text-slate-500">{i.brand}</span>}
          </span>
        )}
        {compact && i.brand && <span className="-mt-1 truncate text-[11px] text-slate-500">{i.brand}</span>}
        <span className="mt-auto">
          <StockBar item={i} unit={i.unit} />
        </span>
        {(!!i.lentOut || !!i.borrowed) && (
          <span className="flex flex-wrap gap-1">
            {!!i.lentOut && <span className="rounded-full bg-[#FFFBEB] px-1.5 text-[10.5px] font-bold text-[#B45309] ring-1 ring-[#FDE68A]">{i.lentOut} lent</span>}
            {!!i.borrowed && <span className="rounded-full bg-[#EEF2FF] px-1.5 text-[10.5px] font-bold text-[#4338CA] ring-1 ring-[#C7D2FE]">{i.borrowed} borrowed</span>}
          </span>
        )}
      </button>
    </div>
  )
}

/** A family of sizes as the same card shape: cover picture, total stock, a row of size chips. */
function FamilyCard({ family, members, a, open, onToggle }: { family: string; members: Item[]; a: Actions; open: boolean; onToggle: () => void }) {
  const total = members.reduce((s, m) => s + Math.max(0, m.stock ?? 0), 0)
  const st = worst(members)
  const nOut = members.filter((m) => stockState(m) === 'out').length
  const cover = members.find((m) => m.imageId) ?? members[0]
  const makers = [...new Set(members.map((m) => m.brand).filter(Boolean))]
  const unit = members[0].unit
  return (
    <div className={cx('group relative flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_2px_rgba(15,23,42,.06)] ring-1 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-8px_rgba(15,23,42,.18)]', open ? 'ring-2 ring-primary' : 'ring-slate-200/80 hover:ring-primary/40')}>
      <div className="relative">
        <Picture item={cover} onClick={onToggle} className="aspect-square w-full border-b border-slate-100" />
        {/* stacked-cards hint: this is a family */}
        <span className="pointer-events-none absolute left-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white shadow-sm">
          <Boxes size={12} /> {members.length} sizes
        </span>
        <span className={cx('pointer-events-none absolute right-2 top-2 rounded-full px-2 py-0.5 text-[11.5px] font-bold shadow-sm ring-1', TONE[st].badge)}>{total}</span>
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <button type="button" onClick={onToggle} className="text-left">
          <span className="line-clamp-2 min-h-[2.6em] text-[13.5px] font-semibold leading-snug text-slate-900">{family}</span>
        </button>
        <span className="flex min-h-[20px] flex-wrap items-center gap-1.5">
          <TypePill type={members[0].type} />
          {makers.length > 0 && <span className="truncate text-[11.5px] font-medium text-slate-500">{makers.join(', ')}</span>}
        </span>
        <span className="flex max-h-[50px] flex-wrap gap-1 overflow-hidden">
          {members.map((m) => (
            <button key={m._id} type="button" onClick={() => a.onOpen(m)} className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 transition hover:brightness-95', TONE[stockState(m)].chip)} title={`${m.name} · ${m.stock ?? 0} ${m.unit}`}>
              {m.variant || m.name.slice(0, 10)} · {m.stock ?? 0}
            </button>
          ))}
        </span>
        <button type="button" onClick={onToggle} className="mt-auto flex items-center justify-between rounded-lg bg-slate-50 px-2 py-1.5 text-[12px] font-semibold text-slate-600 hover:bg-primary-50 hover:text-primary-700">
          <span>
            {total} {unit}
            {nOut > 0 && <span className="text-[#B91C1C]"> · {nOut} out</span>}
          </span>
          <span className="flex items-center gap-0.5">
            {open ? 'Close' : 'All sizes'} {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </span>
        </button>
      </div>
    </div>
  )
}

/** The opened family: its sizes as small cards, across the whole row. */
function FamilyPanel({ family, members, a, onClose, onAddSize }: { family: string; members: Item[]; a: Actions; onClose: () => void; onAddSize?: (from: Item) => void }) {
  return (
    <div className="col-span-full rounded-2xl bg-gradient-to-br from-primary-50 to-white p-4 ring-1 ring-primary/25">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-white">
          <Boxes size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-bold text-slate-900">{family}</div>
          <div className="text-[12px] text-slate-500">
            {members.length} sizes · {members.reduce((s, m) => s + Math.max(0, m.stock ?? 0), 0)} {members[0].unit} in store
          </div>
        </div>
        {onAddSize && (
          <button type="button" onClick={() => onAddSize(members[members.length - 1])} className={btnClass('o', 'sm', 'bg-white')}>
            <Plus size={14} /> Add a size
          </button>
        )}
        <button type="button" onClick={onClose} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-white" aria-label="Close">
          <X size={17} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
        {members.map((m) => (
          <ProductCard key={m._id} i={m} a={a} compact sizeLabel />
        ))}
      </div>
    </div>
  )
}

// ================================================================ list
function ItemList({ items, a }: { items: Item[]; a: Actions }) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-card ring-1 ring-slate-200/80">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-[11px] font-bold uppercase tracking-[.06em] text-slate-500">
              <th className="px-4 py-2.5">Item</th>
              <th className="px-3 py-2.5">Company</th>
              <th className="px-3 py-2.5">Type</th>
              <th className="w-[220px] px-3 py-2.5">In store</th>
              <th className="px-3 py-2.5">Loans</th>
              <th className="px-4 py-2.5 text-right">{a.canStock ? 'Quick' : ''}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i._id} className={cx('border-b border-slate-100 transition last:border-0 hover:bg-slate-50/70', !i.isActive && 'opacity-55')}>
                <td className="px-4 py-2">
                  <div className="flex items-center gap-3">
                    <Picture item={i} onClick={() => a.onPicture(i)} big={false} className="size-11 flex-none rounded-lg ring-1 ring-slate-200" />
                    <button type="button" onClick={() => a.onOpen(i)} className="min-w-0 text-left">
                      <span className="block truncate font-semibold text-slate-900 hover:text-primary-700">{i.name}</span>
                      {(i.family || i.variant) && <span className="block truncate text-[11.5px] text-slate-500">{[i.family !== i.name ? i.family : null, i.variant].filter(Boolean).join(' · ')}</span>}
                    </button>
                  </div>
                </td>
                <td className="px-3 py-2 text-slate-600">{i.brand || <span className="text-slate-300">—</span>}</td>
                <td className="px-3 py-2">
                  <TypePill type={i.type} />
                </td>
                <td className="px-3 py-2">
                  <StockBar item={i} unit={i.unit} />
                </td>
                <td className="px-3 py-2 text-[12px]">
                  {!!i.lentOut && <span className="mr-1 font-semibold text-[#B45309]">{i.lentOut} lent</span>}
                  {!!i.borrowed && <span className="font-semibold text-[#4338CA]">{i.borrowed} borrowed</span>}
                  {!i.lentOut && !i.borrowed && <span className="text-slate-300">—</span>}
                </td>
                <td className="px-4 py-2">
                  <span className="flex justify-end gap-1">
                    {a.canStock && (
                      <>
                        <button type="button" onClick={() => a.onConsume([i._id])} className="flex size-8 items-center justify-center rounded-lg text-[#B91C1C] ring-1 ring-slate-200 hover:bg-red-50" title="Consume">
                          <Minus size={14} strokeWidth={2.6} />
                        </button>
                        <button type="button" onClick={() => a.onReceive([i._id])} className="flex size-8 items-center justify-center rounded-lg text-[#15803D] ring-1 ring-slate-200 hover:bg-emerald-50" title="Receive">
                          <Plus size={14} strokeWidth={2.6} />
                        </button>
                      </>
                    )}
                    <button type="button" onClick={() => a.onOpen(i)} className="flex size-8 items-center justify-center rounded-lg text-slate-500 ring-1 ring-slate-200 hover:bg-slate-100" title="Open">
                      <Pencil size={14} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ================================================================ the view
export function StoreItems({
  items,
  canEdit,
  canStock,
  onOpen,
  onPicture,
  onConsume,
  onReceive,
  onLoan,
  onAdd,
  onAddSize,
}: {
  items: Item[]
  canEdit: boolean
  canStock: boolean
  onOpen: (i: Item) => void
  onPicture: (i: Item) => void
  onConsume: (ids: string[]) => void
  onReceive: (ids: string[]) => void
  onLoan: (direction: 'TAKEN' | 'GIVEN') => void
  onAdd?: () => void
  onAddSize?: (from: Item) => void
}) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<TypeFilter>('ALL')
  const [brand, setBrand] = useState('')
  const [hidden, setHidden] = useState(false)
  const [view, setView] = useState<View>('cards')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [openFamily, setOpenFamily] = useState<string | null>(null)
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setView(remember<View>('hc:store-view', 'cards'))
    setCollapsed(remember<string[]>('hc:store-collapsed', []))
  }, [])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menu])
  const a: Actions = { canStock, onOpen, onPicture, onConsume, onReceive }

  const active = items.filter((i) => i.isActive)
  const nLow = active.filter((i) => stockState(i) === 'low').length
  const nOut = active.filter((i) => stockState(i) === 'out').length
  const units = active.reduce((s, i) => s + Math.max(0, i.stock ?? 0), 0)
  const lent = active.reduce((s, i) => s + (i.lentOut ?? 0), 0)
  const borrowed = active.reduce((s, i) => s + (i.borrowed ?? 0), 0)
  const brands = useMemo(() => [...new Set(items.map((i) => i.brand).filter(Boolean) as string[])].sort(), [items])

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return items
      .filter(
        (i) =>
          (hidden || i.isActive) &&
          (type === 'ALL' || (type === 'LOW' ? stockState(i) !== 'ok' : i.type === type)) &&
          (!brand || i.brand === brand) &&
          words.every((w) => [i.name, i.family, i.variant, i.brand, i.h360Code].some((f) => (f ?? '').toLowerCase().includes(w))),
      )
      .sort((x, y) => (x.family || x.name).localeCompare(y.family || y.name))
  }, [items, q, type, brand, hidden])
  const groups = useMemo(() => groupItems(shown).sort((x, y) => x.family.localeCompare(y.family)), [shown])

  const toggleSection = (k: string) => {
    const next = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k]
    setCollapsed(next)
    save('hc:store-collapsed', next)
  }
  const pickView = (v: View) => {
    setView(v)
    save('hc:store-view', v)
  }

  const grid = (gs: typeof groups) => (
    <div className="grid grid-flow-row-dense grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6">
      {gs.flatMap((g) =>
        g.members.length === 1
          ? [<ProductCard key={g.members[0]._id} i={g.members[0]} a={a} />]
          : [
              <FamilyCard key={`f-${g.family}`} family={g.family} members={g.members} a={a} open={openFamily === g.family} onToggle={() => setOpenFamily(openFamily === g.family ? null : g.family)} />,
              ...(openFamily === g.family ? [<FamilyPanel key={`p-${g.family}`} family={g.family} members={g.members} a={a} onClose={() => setOpenFamily(null)} onAddSize={onAddSize} />] : []),
            ],
      )}
    </div>
  )
  const sections = [
    { key: 'EQUIPMENT', title: 'Equipment', sub: 'Comes back after the visit', icon: Stethoscope, tint: 'from-[#6366F1] to-[#4F46E5]', groups: groups.filter((g) => g.members[0].type === 'EQUIPMENT') },
    { key: 'CONSUMABLE', title: 'Consumables', sub: 'Used up — taken out of stock on visits', icon: Syringe, tint: 'from-[#0EA5E9] to-[#0284C7]', groups: groups.filter((g) => g.members[0].type !== 'EQUIPMENT') },
  ].filter((s) => s.groups.length)

  const kpis: { key: string; label: string; value: number | string; icon: any; tint: string; onClick?: () => void; href?: string; on?: boolean }[] = [
    { key: 'items', label: 'Items', value: active.length, icon: Package, tint: 'from-[#E0F2FE] to-[#F0F9FF] text-[#0369A1]', onClick: () => setType('ALL'), on: type === 'ALL' },
    { key: 'units', label: 'Units in store', value: units.toLocaleString('en-US'), icon: Boxes, tint: 'from-[#CCFBF1] to-[#F0FDFA] text-[#0F766E]' },
    { key: 'low', label: 'Low stock', value: nLow, icon: AlertTriangle, tint: 'from-[#FEF3C7] to-[#FFFBEB] text-[#B45309]', onClick: () => setType('LOW'), on: type === 'LOW' },
    { key: 'out', label: 'Out of stock', value: nOut, icon: PackageMinus, tint: 'from-[#FEE2E2] to-[#FEF2F2] text-[#B91C1C]', onClick: () => setType('LOW'), on: type === 'LOW' },
    { key: 'lent', label: 'Lent out', value: lent, icon: ArrowUpRight, tint: 'from-[#FFEDD5] to-[#FFF7ED] text-[#C2410C]', href: '/store?tab=loans&status=open' },
    { key: 'borrowed', label: 'Borrowed', value: borrowed, icon: ArrowDownLeft, tint: 'from-[#E0E7FF] to-[#EEF2FF] text-[#4338CA]', href: '/store?tab=loans&status=open' },
  ]
  const typeChips: [TypeFilter, string, number][] = [
    ['ALL', 'All', active.length],
    ['CONSUMABLE', 'Consumables', active.filter((i) => i.type !== 'EQUIPMENT').length],
    ['EQUIPMENT', 'Equipment', active.filter((i) => i.type === 'EQUIPMENT').length],
    ['LOW', 'Low / out', nLow + nOut],
  ]
  const stockActions = [
    { label: 'Receive', icon: PackagePlus, tone: 'text-[#15803D]', run: () => onReceive([]) },
    { label: 'Consume', icon: PackageMinus, tone: 'text-[#B91C1C]', run: () => onConsume([]) },
    { label: 'Take loan', icon: ArrowDownLeft, tone: 'text-[#4338CA]', run: () => onLoan('TAKEN') },
    { label: 'Give loan', icon: ArrowUpRight, tone: 'text-[#C2410C]', run: () => onLoan('GIVEN') },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------------------------------------------------------- overview */}
      <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 xl:grid-cols-6">
        {kpis.map((k) => {
          const inner = (
            <>
              <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-white/80 shadow-sm">
                <k.icon size={19} />
              </span>
              <span className="min-w-0">
                <span className="block text-[22px] font-bold leading-none tabular-nums text-slate-900">{k.value}</span>
                <span className="mt-1 block truncate text-[12px] font-semibold opacity-90">{k.label}</span>
              </span>
            </>
          )
          const cls = cx('flex min-w-[160px] snap-start items-center gap-3 rounded-2xl bg-gradient-to-br p-3.5 text-left ring-1 ring-black/5 transition hover:-translate-y-0.5 hover:shadow-md sm:min-w-0', k.tint, k.on && 'ring-2 ring-current')
          return k.href ? (
            <Link key={k.key} href={k.href} className={cls}>
              {inner}
            </Link>
          ) : k.onClick ? (
            <button key={k.key} type="button" onClick={k.onClick} className={cls}>
              {inner}
            </button>
          ) : (
            <div key={k.key} className={cls}>
              {inner}
            </div>
          )
        })}
      </div>

      {/* ---------------------------------------------------------------- toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,.06)] ring-1 ring-slate-200/80">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-9 text-[14px] outline-none transition focus:border-primary focus:bg-white focus:ring-2 focus:ring-primary/20" placeholder="Search item, size, company or H360 code — e.g. cannula 22G" value={q} onChange={(e) => setQ(e.target.value)} />
            {q && (
              <button type="button" onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X size={15} />
              </button>
            )}
          </label>
          {canStock && (
            <>
              {/* wide screens: a button group · narrow: one "Stock" menu */}
              <div className="hidden overflow-hidden rounded-xl ring-1 ring-slate-200 xl:flex">
                {stockActions.map((s, n) => (
                  <button key={s.label} type="button" onClick={s.run} className={cx('flex h-11 items-center gap-1.5 bg-white px-3.5 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50', n > 0 && 'border-l border-slate-200')}>
                    <s.icon size={16} className={s.tone} /> {s.label}
                  </button>
                ))}
              </div>
              <div ref={menuRef} className="relative xl:hidden">
                <button type="button" onClick={() => setMenu(!menu)} className={btnClass('o', 'md', 'h-11 rounded-xl')}>
                  <Boxes size={16} /> Stock <ChevronDown size={14} />
                </button>
                {menu && (
                  <div className="absolute right-0 top-12 z-30 w-48 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-slate-200">
                    {stockActions.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => {
                          setMenu(false)
                          s.run()
                        }}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <s.icon size={16} className={s.tone} /> {s.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
          {onAdd && (
            <button type="button" className={btnClass('p', 'md', 'h-11 rounded-xl')} onClick={onAdd}>
              <Plus size={17} /> Add item
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {typeChips.map(([k, l, n]) => (
            <button key={k} type="button" onClick={() => setType(k)} className={cx('flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold transition', type === k ? (k === 'LOW' ? 'bg-[#B45309] text-white' : 'bg-slate-900 text-white') : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {l}
              <span className={cx('rounded-full px-1.5 text-[11px]', type === k ? 'bg-white/20' : 'bg-white text-slate-500')}>{n}</span>
            </button>
          ))}
          {brands.length > 0 && (
            <select className="h-8 rounded-full border border-slate-200 bg-white px-3 text-[12.5px] font-semibold text-slate-600 outline-none focus:border-primary" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Company">
              <option value="">All companies</option>
              {brands.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <span className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-[12.5px] font-medium text-slate-500">
              <Toggle on={hidden} onChange={setHidden} label="Show hidden items" /> Hidden
            </label>
            <span className="flex rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="View">
              {(
                [
                  ['cards', LayoutGrid, 'Sections'],
                  ['families', Boxes, 'A–Z'],
                  ['list', List, 'List'],
                ] as const
              ).map(([v, Icon, label]) => (
                <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => pickView(v)} className={cx('flex h-7 items-center gap-1 rounded-md px-2.5 text-[12px] font-semibold transition', view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')} title={label}>
                  <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </span>
          </span>
        </div>
      </div>

      {/* ---------------------------------------------------------------- items */}
      {!shown.length ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-white px-6 py-14 text-center shadow-card ring-1 ring-slate-200/80">
          <span className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-50 to-[#E0F2FE] text-primary-700">
            <Package size={30} />
          </span>
          <div className="text-[15px] font-semibold text-slate-800">{items.length ? 'No items match' : 'No items yet'}</div>
          <div className="max-w-[420px] text-[13px] text-slate-500">{items.length ? 'Try another word, or clear the filters.' : 'Add the instruments and consumables your teams take on visits — IV cannula, gloves, BP machine…'}</div>
          {items.length > 0 && (
            <button
              type="button"
              className={btnClass('o', 'sm')}
              onClick={() => {
                setQ('')
                setType('ALL')
                setBrand('')
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : view === 'list' ? (
        <ItemList items={shown} a={a} />
      ) : view === 'families' ? (
        grid(groups)
      ) : (
        <>
          {sections.map((s) => {
            const closed = collapsed.includes(s.key)
            const n = s.groups.reduce((x, g) => x + g.members.length, 0)
            const u = s.groups.reduce((x, g) => x + g.members.reduce((y, m) => y + Math.max(0, m.stock ?? 0), 0), 0)
            return (
              <section key={s.key} className="flex flex-col gap-3">
                <button type="button" onClick={() => toggleSection(s.key)} className="sticky top-0 z-20 -mx-1 flex items-center gap-3 rounded-xl bg-page/90 px-1 py-2 text-left backdrop-blur">
                  <span className={cx('flex size-9 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-sm', s.tint)}>
                    <s.icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-bold text-slate-900">
                      {s.title} <span className="ml-1 rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold text-slate-500 ring-1 ring-slate-200">{n}</span>
                    </span>
                    <span className="block text-[12px] text-slate-500">
                      {u.toLocaleString('en-US')} units · {s.sub}
                    </span>
                  </span>
                  <span className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-slate-700">{closed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span>
                </button>
                {!closed && grid(s.groups)}
              </section>
            )
          })}
        </>
      )}
      {!canEdit && !canStock && <div className="text-center text-[12px] text-slate-400">View only</div>}
    </div>
  )
}
