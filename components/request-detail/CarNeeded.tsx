'use client'
// Request page: add the Unico car to a visit made without one ("Add Unico car"), or take it off ("Remove car") —
// any time before the visit is done, whoever made the request. POST /requests/:id/car (lib/services/requests.ts setCarNeeded).
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, Loader2, X } from 'lucide-react'
import { api, Drawer, useToast } from '@/components/client'
import { ampm, PickupQuickPicks } from '@/components/client/PickupQuickPicks'
import { btnClass } from '@/components/ui'
import { cx } from '@/lib/format'

export type CarNeededProps = {
  requestId: string
  requestNo: string
  /** a Unico car (or "car requested") is on the visit now */
  carOn: boolean
  /** the team is assigned: the requisition goes at once, so the pick-up time is needed now */
  hasTeam: boolean
  /** a requisition or a car already went out: Security / the driver are told it's cancelled */
  told?: boolean
  /** the car has left the hospital — it can no longer be taken off */
  onTrip?: boolean
  visitTime?: string
  recentPickups?: string[]
  /** "button" = small outlined button (amber bar / panel); "link" = text link */
  look?: 'button' | 'link'
}

export function CarNeededButton(p: CarNeededProps) {
  const [open, setOpen] = useState(false)
  if (p.carOn && p.onTrip) return null
  const label = p.carOn ? 'Remove car' : 'Add Unico car'
  return (
    <>
      {p.look === 'link' ? (
        <button type="button" onClick={() => setOpen(true)} className={cx('inline-flex items-center gap-1 text-[13px] font-semibold hover:underline', p.carOn ? 'text-[#B91C1C]' : 'text-primary-700')}>
          {p.carOn ? <X size={13} /> : <Car size={13} />} {label}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={btnClass('o', 'sm', 'bg-white')}>
          {p.carOn ? <X size={14} /> : <Car size={14} />} {label}
        </button>
      )}
      {open && <CarNeededDrawer {...p} onClose={() => setOpen(false)} />}
    </>
  )
}

function CarNeededDrawer({ requestId, requestNo, carOn, hasTeam, told, visitTime, recentPickups, onClose }: CarNeededProps & { onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const [pickup, setPickup] = useState('')
  const [ret, setRet] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!carOn) {
      if (hasTeam && !pickup) return toast('Enter the pick-up time — the requisition goes now', 'err')
      if (pickup && visitTime && pickup >= visitTime) return toast('Pick-up must be before the visit time', 'err')
      if (pickup && ret && ret <= pickup) return toast('Back at hospital must be after pick-up', 'err')
    }
    setBusy(true)
    try {
      await api(`/requests/${requestId}/car`, { body: carOn ? { needed: false, reason: reason.trim() || undefined } : { needed: true, pickupTime: pickup || undefined, returnTime: ret || undefined } })
      toast(carOn ? (told ? 'Car removed — "trip cancelled" is waiting in WhatsApp for approval' : 'Car removed') : hasTeam ? `Unico car added · pick-up ${ampm(pickup)} — the requisition is waiting in WhatsApp for approval` : 'Unico car added — the requisition goes with the assignment', 'ok')
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
      title={carOn ? 'Remove the car' : 'Add Unico car'}
      sub={`${requestNo}${visitTime ? ` · visit ${ampm(visitTime)}` : ''}`}
      width={460}
      footer={
        <div className="flex w-full justify-end gap-2.5">
          <button type="button" className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={btnClass(carOn ? 'rf' : 'p')} disabled={busy} onClick={save}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : carOn ? <X size={16} /> : <Car size={16} />} {carOn ? 'Remove car' : 'Add Unico car'}
          </button>
        </div>
      }
    >
      {carOn ? (
        <div className="flex flex-col gap-3.5">
          <div className="text-[13.5px] text-slate-700">The team will travel on their own. The car, driver and car times come off this visit.</div>
          <label>
            <span className="hc-label">Reason (optional)</span>
            <input className="hc-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Patient's family will bring the team" maxLength={200} />
          </label>
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
            {told ? 'The Security / Transport groups get "trip cancelled" (it waits in WhatsApp for your approval) and the driver gets a notice in the app.' : 'No requisition has gone out yet — nobody needs to be told.'}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="hc-label">Pick-up at hospital{hasTeam ? ' *' : ' (optional)'}</span>
              <input type="time" className="hc-input" value={pickup} onChange={(e) => setPickup(e.target.value)} />
            </label>
            <label>
              <span className="hc-label">Back at hospital (optional)</span>
              <input type="time" className="hc-input" value={ret} onChange={(e) => setRet(e.target.value)} />
            </label>
          </div>
          <PickupQuickPicks visitTime={visitTime} recent={recentPickups} value={pickup} onChange={setPickup} />
          <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-[12.5px] text-slate-600">
            {hasTeam
              ? 'The team is assigned, so the vehicle requisition goes to the security supervisor now, naming the team and this pick-up time. It waits in WhatsApp for your approval. The car supervisor then allots the car and driver.'
              : 'No staff assigned yet — nothing is sent now. The vehicle requisition goes to the security supervisor when you assign the team (the assign drawer asks for the pick-up time if you leave it empty here).'}
          </div>
        </div>
      )}
    </Drawer>
  )
}
