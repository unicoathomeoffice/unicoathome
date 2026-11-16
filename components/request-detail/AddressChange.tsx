'use client'
// Overview → Patient → Address: change it after the request was made (the patient moved, or H360 has a newer address).
// Shows H360's present address when it differs from ours; saving updates the patient, this visit and their other open visits.
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Building2, Loader2, MapPin } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { AddressBlock, ADDRESS_LABELS_EN, type AddressValue } from '@/components/client/AddressBlock'
import { btnClass } from '@/components/ui'

type Status = {
  uhid: string | null
  current: string
  address: { full?: string; house?: string; flat?: string; area?: string; landmark?: string; lat?: number | null; lng?: number | null } | null
  h360: { full: string; area?: string } | null
  differs: boolean
  otherOpen: number
  offline?: string
}

export function AddressChange({ requestId, canEdit }: { requestId: string; canEdit: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [st, setSt] = useState<Status | null>(null)
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<AddressValue>({ road: '', house: '', flat: '', area: '', landmark: '', lat: null, lng: null })
  const [fromH360, setFromH360] = useState(false)
  const [others, setOthers] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!canEdit) return
    let live = true
    api<Status>(`/requests/${requestId}/address`)
      .then((s) => live && setSt(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [requestId, canEdit])
  if (!canEdit) return null

  const start = (useH360: boolean) => {
    const a = st?.address ?? {}
    if (useH360 && st?.h360) setV({ road: st.h360.full, house: '', flat: '', area: st.h360.area ?? '', landmark: '', lat: null, lng: null })
    else setV({ road: a.full ?? '', house: a.house ?? '', flat: a.flat ?? '', area: a.area ?? '', landmark: a.landmark ?? '', lat: a.lat ?? null, lng: a.lng ?? null })
    setFromH360(useH360 && !!st?.h360)
    setOpen(true)
  }
  async function save() {
    if (v.road.trim().length < 3) return toast('Enter the address', 'err')
    setBusy(true)
    try {
      const r = await api<{ otherVisits: number }>(`/requests/${requestId}/address`, {
        body: { address: { full: v.road.trim(), house: v.house.trim() || undefined, flat: v.flat.trim() || undefined, area: v.area.trim() || undefined, landmark: v.landmark.trim() || undefined, lat: v.lat, lng: v.lng }, otherOpen: others, source: fromH360 ? 'H360' : 'TYPED' },
      })
      toast(`Address updated${r.otherVisits ? ` · also on ${r.otherVisits} other open visit${r.otherVisits === 1 ? '' : 's'}` : ''}`, 'ok')
      setOpen(false)
      setSt(null)
      router.refresh()
      api<Status>(`/requests/${requestId}/address`).then(setSt, () => {})
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {st?.differs && st.h360 && (
        <div className="mt-1.5 rounded-lg bg-[#FEF3C7] px-2.5 py-2 text-[12.5px] leading-[17px] text-[#92400E] ring-1 ring-[#FDE68A]">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 flex-none" />
            <span>
              H360 has a different address: <b>{st.h360.full}</b>
            </span>
          </div>
          <button type="button" onClick={() => start(true)} className="mt-1 font-semibold text-[#92400E] underline">
            Use the H360 address
          </button>
        </div>
      )}
      <button type="button" onClick={() => start(false)} className="mt-1 inline-flex items-center gap-1 text-[12.5px] font-semibold text-primary-700 hover:underline">
        <MapPin size={13} /> Change address
      </button>

      {open && (
        <Drawer
          open
          onClose={() => setOpen(false)}
          title="Change the patient's address"
          sub="The patient record (history kept) and this visit"
          width={560}
          footer={
            <div className="flex justify-end gap-2.5">
              <button type="button" className={btnClass('o')} onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className={btnClass('p')} disabled={busy} onClick={save}>
                {busy && <Loader2 size={16} className="animate-spin" />} Save address
              </button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            {st?.h360 ? (
              <div className="flex items-start gap-2.5 rounded-lg bg-[#F5F3FF] px-3 py-2.5 text-[13px] ring-1 ring-[#DDD6FE]">
                <Building2 size={16} className="mt-0.5 flex-none text-[#6D28D9]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] font-semibold uppercase tracking-[.05em] text-[#6D28D9]">In H360 · UHID {st.uhid}</div>
                  <div className="font-semibold">{st.h360.full}</div>
                  {!st.differs && <div className="text-[12px] text-slate-500">Same as the address on file</div>}
                </div>
                <button type="button" onClick={() => start(true)} className={btnClass('o', 'sm', 'flex-none bg-white')}>
                  Use this
                </button>
              </div>
            ) : st?.uhid ? (
              <div className="rounded-lg bg-slate-50 px-3 py-2 text-[12.5px] text-slate-500">{st.offline ? `H360: ${st.offline}` : `No address in H360 for UHID ${st.uhid}`}</div>
            ) : null}
            {fromH360 && <div className="text-[12.5px] text-slate-600">Filled from H360 — add the house / flat and drop the pin at the door if you can.</div>}
            <AddressBlock
              size="md"
              mapHeight={220}
              idPrefix="chg"
              zones={[]}
              value={v}
              onChange={(patch) => setV((x) => ({ ...x, ...patch }))}
              labels={{ ...ADDRESS_LABELS_EN, road: 'Full address *', roadPh: 'House, road, block — or search the map', house: 'House / holding no.', flat: 'Flat / floor', area: 'Area / thana', landmark: 'Landmark', onMap: 'Exact location (optional)', mapHint: 'Drag the pin to the door; staff navigate to it.', useLocation: 'Use this device’s location' }}
            />
            {(st?.otherOpen ?? 0) > 0 && (
              <label className="flex cursor-pointer items-start gap-2.5 rounded-lg bg-slate-50 px-3 py-2.5">
                <input type="checkbox" className="mt-0.5 size-4 accent-[#0090CA]" checked={others} onChange={(e) => setOthers(e.target.checked)} />
                <span className="text-[13px]">
                  <b>Also the patient&rsquo;s other open visits ({st!.otherOpen})</b>
                  <span className="block text-[12px] text-slate-500">Upcoming visits of this patient go to the new address too.</span>
                </span>
              </label>
            )}
            <div className="text-[12px] text-slate-500">Nothing is sent to the team or the patient. The team sees the new address in the app on their next refresh.</div>
          </div>
        </Drawer>
      )}
    </>
  )
}
