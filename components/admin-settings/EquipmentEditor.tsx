'use client'
// Settings → Equipment & consumables: the catalog the services' bags are built from (Settings → Services) — name,
// picture, equipment (comes back) or consumable (used up), unit — and the store: how many are in stock. Consumables
// recorded on visits are taken out of the stock automatically (lib/services/stock.ts). Items in use can only be hidden.
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, ClipboardCheck, EyeOff, ImageOff, Loader2, Package, PackageMinus, PackagePlus, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api, compressImage, Drawer, Segmented, Toggle, useToast } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { cx } from '@/lib/format'
import { groupItems, parseItemName } from '@/lib/store-groups'
import { ConsumeDrawer } from '@/components/store/ConsumeDrawer'
import { usePasteFiles } from '@/components/client/paste'

export type EquipmentDoc = { _id: string; name: string; type: 'EQUIPMENT' | 'CONSUMABLE'; unit: string; imageId?: string | null; notes?: string; isActive: boolean; inUse?: number; stock?: number; alertBelow?: number; family?: string; variant?: string; brand?: string; h360Code?: string }

/** out ≤ 0 · low ≤ alert level · ok */
export const stockState = (i: { stock?: number; alertBelow?: number }) => ((i.stock ?? 0) <= 0 ? 'out' : (i.alertBelow ?? 0) > 0 && (i.stock ?? 0) <= (i.alertBelow ?? 0) ? 'low' : 'ok')
const STOCK_TONE = { out: 'bg-[#FEE2E2] text-[#B91C1C]', low: 'bg-[#FEF3C7] text-[#B45309]', ok: 'bg-[#DCFCE7] text-[#15803D]' } as const

export function StockChip({ item, className }: { item: { stock?: number; alertBelow?: number; unit: string }; className?: string }) {
  const st = stockState(item)
  return (
    <span className={cx('inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full px-2 text-[11.5px] font-semibold', STOCK_TONE[st], className)} title="In the store now">
      <b className="text-[13px]">{item.stock ?? 0}</b> {item.unit} in store{st === 'out' ? ' · out' : st === 'low' ? ' · low' : ''}
    </span>
  )
}

const UNITS = ['pcs', 'pair', 'set', 'box', 'pack', 'roll', 'bottle', 'vial', 'ampoule', 'ml', 'tube', 'strip']
export const equipmentImage = (e: { _id: string; imageId?: string | null }) => (e.imageId ? `/api/v1/equipment/${e._id}/image?v=${e.imageId}` : null)

export function ItemPicture({ item, size = 48, className }: { item: { _id: string; imageId?: string | null; name: string }; size?: number; className?: string }) {
  const src = equipmentImage(item)
  return (
    <span className={cx('flex flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400', className)} style={size ? { width: size, height: size } : undefined}>
      {src ? <img src={src} alt={item.name} className="size-full object-cover" loading="lazy" /> : <Package size={size ? Math.round(size * 0.45) : 28} />}
    </span>
  )
}

export function EquipmentEditor({ items, canEdit, canStock = canEdit }: { items: EquipmentDoc[]; canEdit: boolean; canStock?: boolean }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'ALL' | 'EQUIPMENT' | 'CONSUMABLE' | 'LOW'>('ALL')
  const [brand, setBrand] = useState('')
  const [view, setView] = useState<'GROUPED' | 'ALL'>('GROUPED')
  const [hidden, setHidden] = useState(false)
  const [edit, setEdit] = useState<EquipmentDoc | 'new' | null>(null)
  const [consume, setConsume] = useState<string[] | null>(null)
  const open = (i: EquipmentDoc) => (canEdit || canStock) && setEdit(i)
  const brands = useMemo(() => [...new Set(items.map((i) => i.brand).filter(Boolean) as string[])].sort(), [items])
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter(
      (i) =>
        (hidden || i.isActive) &&
        (type === 'ALL' || (type === 'LOW' ? stockState(i) !== 'ok' : i.type === type)) &&
        (!brand || i.brand === brand) &&
        words.every((w) => [i.name, i.family, i.variant, i.brand, i.h360Code].some((f) => (f ?? '').toLowerCase().includes(w))),
    )
  }, [items, q, type, brand, hidden])
  const groups = useMemo(() => groupItems(shown), [shown])
  const active = items.filter((i) => i.isActive)
  const nLow = active.filter((i) => stockState(i) === 'low').length
  const nOut = active.filter((i) => stockState(i) === 'out').length
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-slate-600">
        <span>
          <b className="text-slate-900">{active.length}</b> items
        </span>
        <span>
          <b className="text-slate-900">{active.reduce((a, i) => a + Math.max(0, i.stock ?? 0), 0).toLocaleString('en-US')}</b> units in stock
        </span>
        {nLow > 0 && <span className="font-semibold text-[#B45309]">{nLow} low</span>}
        {nOut > 0 && <span className="font-semibold text-[#B91C1C]">{nOut} out of stock</span>}
        <span className="text-slate-400">· consumables used on visits are taken out automatically</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="hc-input pl-9" placeholder="Search — item, size, company or H360 code (e.g. cannula 22G, braun)" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented
          value={type}
          onChange={setType}
          items={[
            { value: 'ALL', label: `All · ${active.length}` },
            { value: 'CONSUMABLE', label: 'Consumables' },
            { value: 'EQUIPMENT', label: 'Equipment' },
            { value: 'LOW', label: `Low / out · ${nLow + nOut}` },
          ]}
        />
        {brands.length > 0 && (
          <select className="hc-input w-auto" value={brand} onChange={(e) => setBrand(e.target.value)} aria-label="Company">
            <option value="">All companies</option>
            {brands.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
        <Segmented
          value={view}
          onChange={setView}
          items={[
            { value: 'GROUPED', label: 'By family' },
            { value: 'ALL', label: 'All items' },
          ]}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <Toggle on={hidden} onChange={setHidden} label="Show hidden items" /> Hidden
        </label>
        {canStock && (
          <button type="button" className={btnClass('o')} onClick={() => setConsume([])}>
            <PackageMinus size={16} /> Consume
          </button>
        )}
        {canEdit && (
          <button type="button" className={btnClass('p')} onClick={() => setEdit('new')}>
            <Plus size={16} /> Add item
          </button>
        )}
      </div>
      {!shown.length ? (
        <div className="rounded-card bg-white px-6 py-12 text-center text-[14px] text-slate-500 shadow-card">
          {items.length ? 'No items match.' : 'No items yet — add the instruments and consumables your teams take on visits (e.g. IV cannula, gloves, BP machine).'}
        </div>
      ) : view === 'GROUPED' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {groups.map((g) =>
            g.members.length === 1 ? (
              <ItemCard key={g.members[0]._id} i={g.members[0]} onOpen={open} clickable={canEdit || canStock} />
            ) : (
              <FamilyCard key={g.family} family={g.family} members={g.members} onOpen={open} />
            ),
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((i) => (
            <ItemCard key={i._id} i={i} onOpen={open} clickable={canEdit || canStock} />
          ))}
        </div>
      )}
      {edit && (
        <EditItem
          key={edit === 'new' ? 'new' : edit._id}
          siblings={edit !== 'new' && edit.family ? items.filter((x) => x.family === edit.family && x._id !== edit._id) : []}
          onOpenSibling={(x) => setEdit(x)}
          item={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          canEdit={canEdit}
          canStock={canStock}
          onConsume={(id) => {
            setEdit(null)
            setConsume([id])
          }}
        />
      )}
      {consume && <ConsumeDrawer items={items} preset={consume} onClose={() => setConsume(null)} />}
    </div>
  )
}

function ItemCard({ i, onOpen, clickable }: { i: EquipmentDoc; onOpen: (i: EquipmentDoc) => void; clickable: boolean }) {
  return (
    <button type="button" onClick={() => onOpen(i)} className={cx('flex items-center gap-3 rounded-card bg-white p-3 text-left shadow-card', clickable && 'hover:ring-1 hover:ring-primary', !i.isActive && 'opacity-60')}>
      <ItemPicture item={i} size={64} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14.5px] font-bold text-slate-900" title={i.name}>
          {i.name}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <StockChip item={i} />
          <Tag tone={i.type === 'EQUIPMENT' ? 'indigo' : 'blue'}>{i.type === 'EQUIPMENT' ? 'Equipment' : 'Consumable'}</Tag>
          {i.brand && <span className="text-[11.5px] font-semibold text-slate-500">{i.brand}</span>}
          {!i.isActive && <Tag tone="slate">Hidden</Tag>}
        </span>
        {!!i.inUse && <span className="mt-0.5 block text-[11.5px] text-slate-400">Used in {i.inUse} service / visit record{i.inUse === 1 ? '' : 's'}</span>}
      </span>
    </button>
  )
}

/** One family (e.g. IV cannula) with a chip per size: "22G · B Braun · 3". Click a chip for that item. */
function FamilyCard({ family, members, onOpen }: { family: string; members: EquipmentDoc[]; onOpen: (i: EquipmentDoc) => void }) {
  const total = members.reduce((a, m) => a + Math.max(0, m.stock ?? 0), 0)
  const unit = members[0].unit
  const makers = [...new Set(members.map((m) => m.brand).filter(Boolean))]
  const nOut = members.filter((m) => stockState(m) === 'out').length
  const [all, setAll] = useState(false)
  const shown = all ? members : members.slice(0, 8)
  return (
    <div className="flex flex-col gap-2.5 rounded-card bg-white p-3 shadow-card sm:col-span-2">
      <div className="min-w-0">
        <div className="truncate text-[15px] font-bold text-slate-900">{family}</div>
        <div className="text-[12px] text-slate-500">
          <b className="text-slate-800">{total}</b> {unit} in store · {members.length} sizes{makers.length ? ` · ${makers.join(', ')}` : ''}
          {nOut > 0 && <span className="font-semibold text-[#B91C1C]"> · {nOut} out</span>}
        </div>
      </div>
      {/* one tile per size: its picture, size, company and stock */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
        {shown.map((m) => {
          const st = stockState(m)
          return (
            <button
              key={m._id}
              type="button"
              onClick={() => onOpen(m)}
              title={m.name}
              className={cx(
                'group flex flex-col overflow-hidden rounded-lg border text-left transition hover:ring-2 hover:ring-primary/40',
                st === 'out' ? 'border-[#FECACA]' : st === 'low' ? 'border-[#FDE68A]' : 'border-slate-200',
                !m.isActive && 'opacity-50',
              )}
            >
              <span className="relative block aspect-square w-full bg-slate-100">
                <ItemPicture item={m} size={0} className="!size-full rounded-none" />
                <span className={cx('absolute right-1 top-1 rounded px-1.5 text-[11.5px] font-bold shadow-sm', STOCK_TONE[st])}>{m.stock ?? 0}</span>
              </span>
              <span className="px-1.5 py-1">
                <b className="block truncate text-[12.5px] text-slate-900">{m.variant || m.name}</b>
                {m.brand && <span className="block truncate text-[11px] text-slate-500">{m.brand}</span>}
              </span>
            </button>
          )
        })}
      </div>
      {members.length > 8 && (
        <button type="button" onClick={() => setAll(!all)} className="self-start text-[12px] font-semibold text-primary-700 hover:underline">
          {all ? 'Show fewer' : `+${members.length - 8} more sizes`}
        </button>
      )}
    </div>
  )
}

function EditItem({
  item,
  onClose,
  canEdit = true,
  canStock = true,
  onConsume,
  siblings = [],
  onOpenSibling,
}: {
  item: EquipmentDoc | null
  onClose: () => void
  canEdit?: boolean
  canStock?: boolean
  onConsume?: (id: string) => void
  siblings?: EquipmentDoc[]
  onOpenSibling?: (i: EquipmentDoc) => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [f, setF] = useState({ name: item?.name ?? '', type: item?.type ?? ('CONSUMABLE' as const), unit: item?.unit ?? 'pcs', notes: item?.notes ?? '', isActive: item?.isActive ?? true, alertBelow: String(item?.alertBelow ?? 0), family: item?.family ?? '', variant: item?.variant ?? '', brand: item?.brand ?? '', h360Code: item?.h360Code ?? '' })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(item ? equipmentImage(item) : null)
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null)
  const pick = useRef<HTMLInputElement>(null)
  const noPic = siblings.filter((x) => !x.imageId).length
  const [forFamily, setForFamily] = useState(false)
  const takePicture = (x: File) => {
    setFile(x)
    setPreview(URL.createObjectURL(x))
    if (noPic) setForFamily(true)
  }
  // paste (Ctrl+V) or drop a photo straight onto the drawer
  const { over, dropProps } = usePasteFiles((files) => files[0] && takePicture(files[0]), { accept: ['image/*'] })

  async function save() {
    if (f.name.trim().length < 2) return toast('Enter the item name', 'err')
    setBusy('save')
    try {
      const body = { name: f.name.trim(), type: f.type, unit: f.unit.trim() || 'pcs', notes: f.notes.trim() || undefined, isActive: f.isActive, alertBelow: Math.max(0, Math.round(Number(f.alertBelow) || 0)), family: f.family.trim(), variant: f.variant.trim(), brand: f.brand.trim(), h360Code: f.h360Code.trim() }
      const id = item ? item._id : (await api<{ id: string }>('/master/equipment', { body })).id
      if (item) await api(`/master/equipment/${item._id}`, { method: 'PATCH', body })
      if (file) {
        const form = new FormData()
        form.append('file', await compressImage(file, false))
        await api(`/equipment/${id}/image`, { form })
      }
      // the same picture for the other sizes of the family that have none
      if (forFamily && (file || item?.imageId) && f.family.trim()) {
        const r = await api<{ count: number }>(`/equipment/${id}/image/family`, { body: {} })
        if (r.count) toast(`Picture used for ${r.count} more size${r.count === 1 ? '' : 's'}`, 'ok')
      }
      toast(item ? 'Item saved' : 'Item added', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  /** store managers without catalog rights: only the picture is saved */
  async function savePicture() {
    if (!item) return
    setBusy('save')
    try {
      if (file) {
        const form = new FormData()
        form.append('file', await compressImage(file, false))
        await api(`/equipment/${item._id}/image`, { form })
      }
      if (forFamily && item.family) await api(`/equipment/${item._id}/image/family`, { body: {} })
      toast('Picture saved', 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  async function remove() {
    if (!item) return
    if (item.inUse) {
      // used on a service's bag or a visit: hide it so history still reads right
      setBusy('delete')
      try {
        await api(`/master/equipment/${item._id}`, { method: 'PATCH', body: { isActive: false } })
        toast(`${item.name} hidden — it stays on past visits`, 'ok')
        router.refresh()
        onClose()
      } catch (e: any) {
        toast(e.message, 'err')
      } finally {
        setBusy(null)
      }
      return
    }
    if (!window.confirm(`Delete ${item.name}? This cannot be undone.`)) return
    setBusy('delete')
    try {
      await api(`/master/equipment/${item._id}`, { method: 'DELETE' })
      toast(`${item.name} deleted`, 'ok')
      router.refresh()
      onClose()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={item ? 'Edit item' : 'Add item'}
      sub="Shown with its picture on the bag check before every journey"
      width={460}
      footer={
        <>
          {item && canEdit && (
            <button type="button" disabled={!!busy} onClick={remove} className={cx(btnClass('o'), 'mr-auto text-[#B91C1C]')}>
              {busy === 'delete' ? <Loader2 size={16} className="animate-spin" /> : item.inUse ? <EyeOff size={16} /> : <Trash2 size={16} />} {item.inUse ? 'Hide' : 'Delete'}
            </button>
          )}
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          {(canEdit || (canStock && (file || forFamily))) && (
            <button type="button" disabled={!!busy} className={btnClass('p')} onClick={canEdit ? save : savePicture}>
              {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
            </button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {item && <StockSection item={item} canStock={canStock} onConsume={onConsume ? () => onConsume(item._id) : undefined} />}
        {siblings.length > 0 && (
          <div>
            <div className="mb-1 text-[12px] font-semibold text-slate-600">Other sizes in {item?.family}</div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {siblings.map((x) => (
                <button key={x._id} type="button" onClick={() => onOpenSibling?.(x)} title={x.name} className="flex w-[64px] flex-none flex-col items-center gap-0.5 rounded-lg p-1 hover:bg-slate-50">
                  <ItemPicture item={x} size={52} />
                  <span className="w-full truncate text-center text-[11px] font-semibold">{x.variant || x.name}</span>
                  <span className={cx('rounded px-1 text-[10.5px] font-bold', STOCK_TONE[stockState(x)])}>{x.stock ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div {...(dropProps as any)} className={cx('flex items-center gap-4 rounded-xl p-1', over && 'bg-primary-50 ring-2 ring-primary')}>
          <span className="flex size-28 flex-none items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">{preview ? <img src={preview} alt="" className="size-full object-cover" /> : <ImageOff size={30} />}</span>
          <div className="flex flex-col gap-2">
            <button type="button" className={btnClass('o', 'sm')} onClick={() => pick.current?.click()}>
              <Camera size={15} /> {preview ? 'Change picture' : 'Add picture'}
            </button>
            <span className="text-[12px] text-slate-500">A clear photo — or paste (Ctrl+V) / drop one here.</span>
            {!!f.family.trim() && siblings.length > 0 && (preview || file) && (
              <label className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" className="size-4 accent-[#0090CA]" checked={forFamily} onChange={(e) => setForFamily(e.target.checked)} />
                Use for the other sizes{noPic ? ` without a picture (${noPic})` : ''}
              </label>
            )}
            <input
              ref={pick}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const x = e.target.files?.[0]
                e.target.value = ''
                if (!x) return
                takePicture(x)
              }}
            />
          </div>
        </div>
        <label>
          <span className="hc-label">Name *</span>
          <input className="hc-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. IV cannula 22G" />
        </label>
        <div className="rounded-lg bg-slate-50 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-slate-600">Family · size · company — sizes of one family show together</span>
            <button type="button" className="text-[12px] font-semibold text-primary-700 hover:underline" onClick={() => setF((x) => ({ ...x, ...parseItemName(x.name) }))}>
              Suggest from name
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input className="hc-input" value={f.family} onChange={(e) => setF({ ...f, family: e.target.value })} placeholder="IV cannula" aria-label="Family" />
            <input className="hc-input" value={f.variant} onChange={(e) => setF({ ...f, variant: e.target.value })} placeholder="22G" aria-label="Size" />
            <input className="hc-input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} placeholder="B Braun" aria-label="Company" />
          </div>
          <input className="hc-input mt-2" value={f.h360Code} onChange={(e) => setF({ ...f, h360Code: e.target.value })} placeholder="H360 item code, e.g. 26898373" aria-label="H360 item code" />
        </div>
        <div>
          <span className="hc-label">Type</span>
          <Segmented
            value={f.type}
            onChange={(v) => setF({ ...f, type: v })}
            items={[
              { value: 'CONSUMABLE', label: 'Consumable · used up' },
              { value: 'EQUIPMENT', label: 'Equipment · comes back' },
            ]}
          />
        </div>
        <label>
          <span className="hc-label">Unit</span>
          <input className="hc-input" list="equipment-units" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
          <datalist id="equipment-units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </label>
        <label>
          <span className="hc-label">Low-stock alert below</span>
          <input className="hc-input" inputMode="numeric" value={f.alertBelow} onChange={(e) => setF({ ...f, alertBelow: e.target.value.replace(/\D/g, '') })} placeholder="0 = no alert" />
          <span className="mt-1 block text-[12px] text-slate-500">When visits bring it down to this number, admins get a notification.</span>
        </label>
        <label>
          <span className="hc-label">Notes</span>
          <textarea className="hc-input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="Size, brand, where it is kept…" />
        </label>
        <label className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2.5 text-[13px]">
          <span>
            <b>Active</b> <span className="text-slate-500">· hidden items can't be added to a service</span>
          </span>
          <Toggle on={f.isActive} onChange={(v) => setF({ ...f, isActive: v })} label="Active" />
        </label>
      </div>
    </Drawer>
  )
}

type Move = { id: string; at: string; delta: number; balance: number | null; reason: 'OPENING' | 'RECEIVED' | 'VISIT' | 'ADJUST' | 'MANUAL'; note: string; by: string | null; requestId: string | null; requestNo: string | null }
const REASON = { OPENING: 'Opening stock', RECEIVED: 'Received', VISIT: 'Visit', ADJUST: 'Stock count', MANUAL: 'Consumed' } as const

/** The store part of the drawer: count now, "Received +", "Counted" (stock-take) and the history of moves. */
function StockSection({ item, canStock = true, onConsume }: { item: EquipmentDoc; canStock?: boolean; onConsume?: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [stock, setStock] = useState(item.stock ?? 0)
  const [moves, setMoves] = useState<Move[] | null>(null)
  const [recv, setRecv] = useState('')
  const [count, setCount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<null | 'receive' | 'count'>(null)
  const load = () =>
    api<{ items: Move[] }>(`/equipment/${item._id}/stock`)
      .then((r) => setMoves(r.items))
      .catch(() => setMoves([]))
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item._id])
  async function go(action: 'receive' | 'count') {
    const qty = Number(action === 'receive' ? recv : count)
    if (action === 'receive' && !(qty > 0)) return toast('Enter how many came in', 'err')
    if (action === 'count' && (count === '' || Number.isNaN(qty))) return toast('Enter the counted number', 'err')
    setBusy(action)
    try {
      const r = await api<{ stock: number; delta: number }>(`/equipment/${item._id}/stock`, { body: { action, qty, note: note.trim() || undefined } })
      setStock(r.stock)
      setRecv('')
      setCount('')
      setNote('')
      toast(action === 'receive' ? `+${qty} ${item.unit} received · ${r.stock} in store` : r.delta ? `Count set to ${r.stock} (${r.delta > 0 ? '+' : ''}${r.delta})` : 'Count unchanged', 'ok')
      load()
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }
  const st = stockState({ stock, alertBelow: item.alertBelow })
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12px] font-semibold uppercase tracking-[.05em] text-slate-500">In the store</span>
        {item.type === 'EQUIPMENT' && <span className="text-[11.5px] text-slate-500">Equipment comes back — not taken out on visits</span>}
      </div>
      <div className={cx('mt-0.5 text-[30px] font-bold leading-tight', st === 'out' ? 'text-[#B91C1C]' : st === 'low' ? 'text-[#B45309]' : 'text-slate-900')}>
        {stock} <span className="text-[15px] font-semibold text-slate-500">{item.unit}</span>
      </div>
      {canStock && (
      <>
      <div className="mt-2.5 grid grid-cols-2 gap-2">
        <div>
          <span className="hc-label">Received</span>
          <div className="flex gap-1.5">
            <input className="hc-input min-w-0" inputMode="numeric" placeholder="+ qty" value={recv} onChange={(e) => setRecv(e.target.value.replace(/\D/g, ''))} />
            <button type="button" disabled={!!busy} onClick={() => go('receive')} className={btnClass('p', 'md', 'flex-none px-3')} title="Add to stock">
              {busy === 'receive' ? <Loader2 size={15} className="animate-spin" /> : <PackagePlus size={15} />}
            </button>
          </div>
        </div>
        <div>
          <span className="hc-label">Counted (stock-take)</span>
          <div className="flex gap-1.5">
            <input className="hc-input min-w-0" inputMode="numeric" placeholder={String(stock)} value={count} onChange={(e) => setCount(e.target.value.replace(/[^\d-]/g, ''))} />
            <button type="button" disabled={!!busy} onClick={() => go('count')} className={btnClass('o', 'md', 'flex-none bg-white px-3')} title="Set the count">
              {busy === 'count' ? <Loader2 size={15} className="animate-spin" /> : <ClipboardCheck size={15} />}
            </button>
          </div>
        </div>
      </div>
      <input className="hc-input mt-2" placeholder="Note (optional) — e.g. H360 requisition or invoice no." value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      {onConsume && (
        <button type="button" onClick={onConsume} className={btnClass('o', 'sm', 'mt-2 bg-white')}>
          <PackageMinus size={14} /> Consume by hand (clinic, wastage, expired…)
        </button>
      )}
      </>
      )}
      <div className="mt-3 text-[12px] font-semibold text-slate-600">History</div>
      {!moves ? (
        <Loader2 size={15} className="mt-1 animate-spin text-slate-400" />
      ) : !moves.length ? (
        <div className="mt-1 text-[12.5px] text-slate-400">No moves yet</div>
      ) : (
        <ul className="mt-1 max-h-[220px] divide-y divide-slate-200 overflow-y-auto rounded-lg bg-white ring-1 ring-slate-200">
          {moves.map((m) => (
            <li key={m.id} className="flex items-center gap-2.5 px-2.5 py-1.5 text-[12.5px]">
              <span className={cx('w-12 flex-none text-right font-bold', m.delta < 0 ? 'text-[#B91C1C]' : 'text-[#15803D]')}>
                {m.delta > 0 ? '+' : ''}
                {m.delta}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">
                  <b>{REASON[m.reason]}</b>
                  {m.note ? ` · ${m.note}` : ''}
                  {m.requestId && (
                    <Link href={`/requests/${m.requestId}`} className="ml-1 text-primary-700 hover:underline">
                      {m.requestNo}
                    </Link>
                  )}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {new Date(m.at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                  {m.by ? ` · ${m.by}` : ''}
                </span>
              </span>
              <span className="flex-none text-slate-500">= {m.balance ?? '—'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
