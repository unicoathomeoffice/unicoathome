'use client'
// "Pack your bag": the visit's items with pictures (from its services, Settings → Services → Bag & consumables).
// Must-take items have to be packed before Start journey; recommended extras are a reminder.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Briefcase, Check, Minus, Plus } from 'lucide-react'
import { api, useToast } from '@/components/client'
import { ItemPicture } from '@/components/admin-settings/EquipmentEditor'
import { cx } from '@/lib/format'

export type KitRowView = { itemId: string; name: string; type: string; unit: string; imageId: string | null; recommendedQty: number; minQty: number; packedQty: number; packedAt: string | null; packedByName: string | null }

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }) : '')

export function KitCard({ requestId, rows: initial, canPack, big = false, locked = false }: { requestId: string; rows: KitRowView[]; canPack: boolean; big?: boolean; locked?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [rows, setRows] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)
  if (!rows.length) return null
  const must = rows.filter((r) => r.minQty > 0)
  const ready = must.filter((r) => r.packedQty >= r.minQty).length
  const editable = canPack && !locked

  async function setQty(r: KitRowView, q: number) {
    const packedQty = Math.max(0, Math.min(99, q))
    setRows((x) => x.map((y) => (y.itemId === r.itemId ? { ...y, packedQty } : y)))
    setBusy(r.itemId)
    try {
      await api(`/requests/${requestId}/kit/${r.itemId}`, { method: 'PATCH', body: { packedQty } })
      router.refresh()
    } catch (e: any) {
      setRows((x) => x.map((y) => (y.itemId === r.itemId ? { ...y, packedQty: r.packedQty } : y)))
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section id="bag" className="scroll-mt-20 rounded-card bg-white p-4 shadow-card">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold">
          <Briefcase size={17} className="text-primary-700" /> {locked ? 'Bag' : 'Pack your bag'}
        </h2>
        {must.length > 0 && <span className={cx('text-[12.5px] font-semibold', ready === must.length ? 'text-[#15803D]' : 'text-[#B45309]')}>{ready === must.length ? 'Ready to go' : `${ready} of ${must.length} must-take packed`}</span>}
      </div>
      {!locked && <div className="mb-1 text-[12.5px] text-slate-500">Tap + for what you put in the bag. Must-take items are needed before Start journey.</div>}
      <ul className="flex flex-col divide-y divide-slate-100">
        {rows.map((r) => {
          const ok = r.minQty > 0 ? r.packedQty >= r.minQty : r.packedQty > 0
          return (
            <li key={r.itemId} className={cx('flex items-center gap-3', big ? 'py-3' : 'py-2.5')}>
              <span className="relative">
                <ItemPicture item={{ _id: r.itemId, imageId: r.imageId, name: r.name }} size={big ? 56 : 44} />
                {ok && (
                  <span className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-[#16A34A] text-white ring-2 ring-white">
                    <Check size={12} strokeWidth={3} />
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cx('font-semibold text-slate-800', big ? 'text-[15px]' : 'text-[14px]')}>{r.name}</div>
                <div className="text-[12px] text-slate-500">
                  Recommended {r.recommendedQty} {r.unit}
                  {r.minQty > 0 ? <b className="text-[#B91C1C]"> · must take {r.minQty}</b> : ' · optional'}
                  {r.packedAt && r.packedQty > 0 ? ` · packed ${hm(r.packedAt)}${r.packedByName ? ` by ${r.packedByName.split(' ')[0]}` : ''}` : ''}
                </div>
              </div>
              {editable ? (
                <span className="flex flex-none items-center gap-1.5">
                  <button type="button" disabled={busy === r.itemId || r.packedQty <= 0} onClick={() => setQty(r, r.packedQty - 1)} className={cx('flex items-center justify-center rounded-lg border-[1.5px] border-slate-300 text-slate-700 disabled:opacity-40', big ? 'size-11' : 'size-8')} aria-label={`One less ${r.name}`}>
                    <Minus size={16} />
                  </button>
                  <span className={cx('w-8 text-center font-bold tabular-nums', big ? 'text-[18px]' : 'text-[15px]')}>{r.packedQty}</span>
                  <button type="button" disabled={busy === r.itemId} onClick={() => setQty(r, r.packedQty + 1)} className={cx('flex items-center justify-center rounded-lg bg-primary text-white disabled:opacity-60', big ? 'size-11' : 'size-8')} aria-label={`One more ${r.name}`}>
                    <Plus size={16} />
                  </button>
                </span>
              ) : (
                <span className="flex-none text-[14px] font-bold tabular-nums text-slate-700">
                  {r.packedQty} / {r.recommendedQty}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
