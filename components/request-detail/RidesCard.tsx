'use client'
// "Rides & screenshots" — own rides for a visit (Uber / Pathao / CNG / rickshaw…), added on the visit or any time
// later. Each ride goes to the security supervisor as one PDF (requisition form + screenshots) and onto the payer's
// conveyance claim with the screenshots as receipts. Used in the field app (visit screen) and on the admin request page.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bike, Camera, Car, CheckCircle2, Eye, Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import { api, compressImage, Sheet, useToast } from '@/components/client'
import { usePasteFiles } from '@/components/client/paste'
import { useConfirmSend } from '@/components/client/ConfirmSend'
import { cx, taka } from '@/lib/format'

export type Ride = { _id: string; userId: string; leg: 'OUT' | 'BACK' | 'BOTH' | 'OTHER'; mode: string; amount?: number; at?: string; attachmentIds: string[]; note?: string; claimLineId?: string; requisitionId?: string; sentAt?: string }
type Person = { id: string; name: string }

const MODES = ['Uber', 'Pathao', 'CNG', 'Rickshaw', 'Bus', 'Other']
const LEGS: [Ride['leg'], string][] = [
  ['OUT', 'To patient'],
  ['BACK', 'Back to hospital'],
  ['BOTH', 'Both ways'],
  ['OTHER', 'Other trip'],
]
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '')
const local = (iso?: string) => {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(iso ? new Date(iso) : new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`
}

export function RidesCard({ requestId, rides, team, me, canPickPayer, mobile = false }: { requestId: string; rides: Ride[]; team: Person[]; me: string; canPickPayer: boolean; mobile?: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const name = (id: string) => team.find((p) => p.id === id)?.name ?? 'Staff'
  const { confirmSend, confirmDialog } = useConfirmSend()

  async function act(rideId: string, kind: 'send' | 'delete') {
    if (kind === 'delete' && !confirm('Remove this ride? It also comes off the open claim.')) return
    if (kind === 'send') {
      const ride = rides.find((x) => x._id === rideId)
      const ok = await confirmSend({
        title: 'Send this ride to the security supervisor?',
        to: [{ name: 'On-call security supervisor' }],
        files: [`Vehicle requisition with the ride screenshot${ride ? ` · ${ride.mode}${ride.amount ? ` · ৳${ride.amount}` : ''}` : ''} (PDF)`],
      })
      if (!ok) return
    }
    setBusy(`${rideId}:${kind}`)
    try {
      if (kind === 'send') {
        const r = await api<{ sent: number }>(`/requests/${requestId}/rides/${rideId}/send`, { body: {} })
        toast(r.sent ? 'Sent to the security supervisor' : 'PDF made — not sent (WhatsApp not paired or no supervisor set)', r.sent ? 'ok' : 'err')
      } else {
        await api(`/requests/${requestId}/rides/${rideId}`, { method: 'DELETE' })
        toast('Ride removed', 'ok')
      }
      router.refresh()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cx('bg-white shadow-card', mobile ? 'rounded-card p-4' : 'rounded-card p-4')}>
      <div className="flex items-center gap-2">
        <Bike size={18} className="text-primary-700" />
        <h2 className="text-[15px] font-bold">Rides &amp; screenshots</h2>
        <span className="text-[12px] text-slate-500">Uber · Pathao · CNG · rickshaw</span>
        <button type="button" onClick={() => setAdding(true)} className={cx('ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary font-semibold text-white', mobile ? 'h-10 px-3.5 text-[14px]' : 'h-8 px-3 text-[13px]')}>
          <Plus size={15} /> Add ride
        </button>
      </div>
      {!rides.length ? (
        <p className="mt-2 text-[13px] text-slate-500">Went by Uber, Pathao or rickshaw and paid yourself? Add the ride with its screenshot — any time, even after the visit. It goes to security with the requisition form and onto your claim.</p>
      ) : (
        <div className="mt-2.5 flex flex-col divide-y divide-slate-100">
          {rides.map((r) => (
            <div key={r._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="flex size-9 flex-none items-center justify-center rounded-xl bg-primary-50 text-primary-700">{r.mode === 'Rickshaw' ? <Bike size={17} /> : <Car size={17} />}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">
                  {r.mode} · {LEGS.find((l) => l[0] === r.leg)?.[1]}
                  {r.amount ? ` · ${taka(r.amount)}` : ''}
                </span>
                <span className="block truncate text-[12px] text-slate-500">
                  {when(r.at)} · paid by {r.userId === me ? 'me' : name(r.userId)}
                  {r.claimLineId ? ' · on claim ✓' : r.amount ? '' : ' · add the fare to claim it'}
                  {r.sentAt ? ' · sent to security ✓' : ''}
                </span>
              </span>
              <span className="flex gap-1.5">
                {r.attachmentIds.slice(0, 3).map((id) => (
                  <a key={id} href={`/api/v1/attachments/${id}`} target="_blank" rel="noreferrer">
                    <img src={`/api/v1/attachments/${id}`} alt="Screenshot" className="size-10 rounded-md object-cover ring-1 ring-slate-200" />
                  </a>
                ))}
              </span>
              <span className="flex gap-0.5">
                {r.requisitionId && (
                  <a href={`/api/v1/attachments/${r.requisitionId}`} target="_blank" rel="noreferrer" className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700" title="Requisition PDF">
                    <Eye size={15} />
                  </a>
                )}
                <button type="button" title="Send to security again" disabled={!!busy} onClick={() => act(r._id, 'send')} className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50 hover:text-primary-700">
                  {busy === `${r._id}:send` ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
                </button>
                <button type="button" title="Remove" disabled={!!busy} onClick={() => act(r._id, 'delete')} className="flex size-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-50 hover:text-[#B91C1C]">
                  {busy === `${r._id}:delete` ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {adding && <AddRide requestId={requestId} team={team} me={me} canPickPayer={canPickPayer} onClose={() => setAdding(false)} onDone={() => (setAdding(false), router.refresh())} />}
      {confirmDialog}
    </section>
  )
}

function AddRide({ requestId, team, me, canPickPayer, onClose, onDone }: { requestId: string; team: Person[]; me: string; canPickPayer: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [v, setV] = useState({ leg: 'OUT' as Ride['leg'], mode: 'Uber', amount: '', at: local(), note: '', paidBy: team.some((p) => p.id === me) ? me : team[0]?.id ?? me })
  const [shots, setShots] = useState<{ id: string; url: string }[]>([])
  const [uploading, setUploading] = useState(false)
  const [busy, setBusy] = useState(false)

  // a ride screenshot copied from the phone / WhatsApp Web pastes straight in (Ctrl+V), or drops onto the sheet
  const { over, dropProps } = usePasteFiles((files) => addShots(files), { enabled: !uploading && shots.length < 5, accept: ['image/*'] })
  async function addShots(list: FileList | File[] | null) {
    if (!list) return
    setUploading(true)
    try {
      for (const f of Array.from(list).slice(0, 5 - shots.length)) {
        if (!f.type.startsWith('image/')) continue
        const form = new FormData()
        form.append('file', await compressImage(f, false))
        form.append('kind', 'RECEIPT')
        form.append('requestId', requestId)
        form.append('caption', 'Ride screenshot')
        const r = await api<{ id: string; url: string }>('/attachments', { form })
        setShots((x) => [...x, { id: r.id, url: r.url }])
      }
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setUploading(false)
    }
  }
  async function save() {
    setBusy(true)
    try {
      await api(`/requests/${requestId}/rides`, {
        body: { leg: v.leg, mode: v.mode, amount: v.amount ? Number(v.amount) : undefined, at: new Date(`${v.at}:00+06:00`).toISOString(), note: v.note || undefined, attachmentIds: shots.map((s) => s.id), paidBy: canPickPayer ? v.paidBy : undefined },
      })
      toast(v.amount ? 'Ride added · sent to security and put on the claim' : 'Ride added · sent to security (add the fare later to claim it)', 'ok')
      onDone()
    } catch (e: any) {
      toast(e.message, 'err')
    } finally {
      setBusy(false)
    }
  }
  const chip = (on: boolean) => cx('h-10 rounded-full border-[1.5px] px-3.5 text-[13.5px] font-semibold', on ? 'border-primary bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600')
  return (
    <Sheet open onClose={onClose} title="Add ride" sub="Your own Uber / Pathao / CNG / rickshaw for this visit">
      <div className="flex flex-col gap-3 pb-3">
        <div className="grid grid-cols-2 gap-2">
          {LEGS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setV({ ...v, leg: k })} className={cx('h-11 rounded-xl border-[1.5px] text-[13.5px] font-semibold', v.leg === k ? 'border-primary bg-primary text-white' : 'border-slate-200 bg-white text-slate-700')}>
              {l}
            </button>
          ))}
        </div>
        {v.leg === 'BOTH' && <p className="-mt-1 text-[12.5px] text-slate-500">Hospital → patient → hospital on one fare. Enter the total for the round trip.</p>}
        <div className="flex flex-wrap gap-2">
          {MODES.map((m) => (
            <button key={m} type="button" onClick={() => setV({ ...v, mode: m })} className={chip(v.mode === m)}>
              {m}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <label>
            <span className="hc-label">{v.leg === 'BOTH' ? 'Total fare, both ways (৳)' : 'Fare paid (৳)'}</span>
            <input className="hc-input hc-input-lg !text-[18px] font-bold" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
          </label>
          <label>
            <span className="hc-label">Date &amp; time</span>
            <input type="datetime-local" className="hc-input hc-input-lg" value={v.at} onChange={(e) => setV({ ...v, at: e.target.value })} />
          </label>
        </div>
        {canPickPayer && team.length > 0 && (
          <label>
            <span className="hc-label">Paid by</span>
            <select className="hc-input hc-input-lg" value={v.paidBy} onChange={(e) => setV({ ...v, paidBy: e.target.value })}>
              {team.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div>
          <span className="hc-label">Ride screenshots (fare, route)</span>
          <div className="flex flex-wrap items-center gap-2">
            {shots.map((s) => (
              <span key={s.id} className="relative">
                <img src={s.url} alt="Screenshot" className="h-20 w-14 rounded-lg object-cover ring-1 ring-slate-200" />
                <button type="button" onClick={() => setShots((x) => x.filter((y) => y.id !== s.id))} className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-slate-900 text-white" aria-label="Remove screenshot">
                  <X size={13} />
                </button>
              </span>
            ))}
            {shots.length < 5 && (
              <label {...dropProps} title="Choose, drop or paste (Ctrl+V) screenshots" className={cx('flex h-20 w-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-lg border-[1.5px] border-dashed text-[11px] text-slate-500', over ? 'border-primary bg-primary-50' : 'border-slate-300')}>
                {uploading ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                Add
                <input type="file" accept="image/*" multiple className="sr-only" onChange={(e) => (addShots(e.target.files), (e.target.value = ''))} />
              </label>
            )}
          </div>
        </div>
        <label>
          <span className="hc-label">Note (optional)</span>
          <input className="hc-input" value={v.note} onChange={(e) => setV({ ...v, note: e.target.value })} placeholder="e.g. no CNG available, took Pathao" />
        </label>
        <button type="button" disabled={busy || uploading} onClick={save} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary text-base font-bold text-white disabled:opacity-60">
          {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />} Add ride
        </button>
      </div>
    </Sheet>
  )
}
