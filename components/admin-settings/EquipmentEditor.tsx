'use client'
// Settings → Equipment & consumables: the catalog the services' bags are built from (Settings → Services) — name,
// picture, equipment (comes back) or consumable (used up), unit. Items in use can only be hidden, not deleted.
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, EyeOff, ImageOff, Loader2, Package, Plus, Save, Search, Trash2 } from 'lucide-react'
import { api, compressImage, Drawer, Segmented, Toggle, useToast } from '@/components/client'
import { btnClass, Tag } from '@/components/ui'
import { cx } from '@/lib/format'

export type EquipmentDoc = { _id: string; name: string; type: 'EQUIPMENT' | 'CONSUMABLE'; unit: string; imageId?: string | null; notes?: string; isActive: boolean; inUse?: number }

const UNITS = ['pcs', 'pair', 'set', 'box', 'pack', 'roll', 'bottle', 'vial', 'ampoule', 'ml', 'tube', 'strip']
export const equipmentImage = (e: { _id: string; imageId?: string | null }) => (e.imageId ? `/api/v1/equipment/${e._id}/image?v=${e.imageId}` : null)

export function ItemPicture({ item, size = 48, className }: { item: { _id: string; imageId?: string | null; name: string }; size?: number; className?: string }) {
  const src = equipmentImage(item)
  return (
    <span className={cx('flex flex-none items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-400', className)} style={{ width: size, height: size }}>
      {src ? <img src={src} alt={item.name} className="size-full object-cover" loading="lazy" /> : <Package size={Math.round(size * 0.45)} />}
    </span>
  )
}

export function EquipmentEditor({ items, canEdit }: { items: EquipmentDoc[]; canEdit: boolean }) {
  const [q, setQ] = useState('')
  const [type, setType] = useState<'ALL' | 'EQUIPMENT' | 'CONSUMABLE'>('ALL')
  const [hidden, setHidden] = useState(false)
  const [edit, setEdit] = useState<EquipmentDoc | 'new' | null>(null)
  const shown = useMemo(
    () => items.filter((i) => (hidden || i.isActive) && (type === 'ALL' || i.type === type) && (!q.trim() || i.name.toLowerCase().includes(q.trim().toLowerCase()))),
    [items, q, type, hidden],
  )
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative min-w-[220px] flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input className="hc-input pl-9" placeholder="Search items" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented
          value={type}
          onChange={setType}
          items={[
            { value: 'ALL', label: `All · ${items.filter((i) => i.isActive).length}` },
            { value: 'CONSUMABLE', label: 'Consumables' },
            { value: 'EQUIPMENT', label: 'Equipment' },
          ]}
        />
        <label className="flex items-center gap-2 text-[13px] text-slate-600">
          <Toggle on={hidden} onChange={setHidden} label="Show hidden items" /> Show hidden
        </label>
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
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {shown.map((i) => (
            <button key={i._id} type="button" onClick={() => canEdit && setEdit(i)} className={cx('flex items-center gap-3 rounded-card bg-white p-3 text-left shadow-card', canEdit && 'hover:ring-1 hover:ring-primary', !i.isActive && 'opacity-60')}>
              <ItemPicture item={i} size={64} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold text-slate-900">{i.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Tag tone={i.type === 'EQUIPMENT' ? 'indigo' : 'blue'}>{i.type === 'EQUIPMENT' ? 'Equipment' : 'Consumable'}</Tag>
                  <span className="text-[12px] text-slate-500">per {i.unit}</span>
                  {!i.isActive && <Tag tone="slate">Hidden</Tag>}
                </span>
                {!!i.inUse && <span className="mt-0.5 block text-[11.5px] text-slate-400">Used in {i.inUse} service / visit record{i.inUse === 1 ? '' : 's'}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      {edit && <EditItem item={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

function EditItem({ item, onClose }: { item: EquipmentDoc | null; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [f, setF] = useState({ name: item?.name ?? '', type: item?.type ?? ('CONSUMABLE' as const), unit: item?.unit ?? 'pcs', notes: item?.notes ?? '', isActive: item?.isActive ?? true })
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(item ? equipmentImage(item) : null)
  const [busy, setBusy] = useState<null | 'save' | 'delete'>(null)
  const pick = useRef<HTMLInputElement>(null)

  async function save() {
    if (f.name.trim().length < 2) return toast('Enter the item name', 'err')
    setBusy('save')
    try {
      const body = { name: f.name.trim(), type: f.type, unit: f.unit.trim() || 'pcs', notes: f.notes.trim() || undefined, isActive: f.isActive }
      const id = item ? item._id : (await api<{ id: string }>('/master/equipment', { body })).id
      if (item) await api(`/master/equipment/${item._id}`, { method: 'PATCH', body })
      if (file) {
        const form = new FormData()
        form.append('file', await compressImage(file, false))
        await api(`/equipment/${id}/image`, { form })
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
          {item && (
            <button type="button" disabled={!!busy} onClick={remove} className={cx(btnClass('o'), 'mr-auto text-[#B91C1C]')}>
              {busy === 'delete' ? <Loader2 size={16} className="animate-spin" /> : item.inUse ? <EyeOff size={16} /> : <Trash2 size={16} />} {item.inUse ? 'Hide' : 'Delete'}
            </button>
          )}
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" disabled={!!busy} className={btnClass('p')} onClick={save}>
            {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <span className="flex size-28 flex-none items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-slate-400">{preview ? <img src={preview} alt="" className="size-full object-cover" /> : <ImageOff size={30} />}</span>
          <div className="flex flex-col gap-2">
            <button type="button" className={btnClass('o', 'sm')} onClick={() => pick.current?.click()}>
              <Camera size={15} /> {preview ? 'Change picture' : 'Add picture'}
            </button>
            <span className="text-[12px] text-slate-500">A clear photo of the item, so staff recognise it when packing.</span>
            <input
              ref={pick}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const x = e.target.files?.[0]
                e.target.value = ''
                if (!x) return
                setFile(x)
                setPreview(URL.createObjectURL(x))
              }}
            />
          </div>
        </div>
        <label>
          <span className="hc-label">Name *</span>
          <input className="hc-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. IV cannula 22G" />
        </label>
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
