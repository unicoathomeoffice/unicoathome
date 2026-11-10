'use client'
// Request page: where the team is right now (live map + ETA) and the whole trip — left, arrived, check-out, back.
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { LiveMap, type LiveData } from '@/components/client/LiveMap'
import { api, useToast } from '@/components/client'
import { cx } from '@/lib/format'

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }) : '—')
const mins = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 60000)) : null)

export function LiveTrackingCard({
  requestId,
  initial,
  staffName,
  times,
  canSetBack = false,
  noHospitalPin = false,
}: {
  requestId: string
  initial: LiveData
  staffName: string
  times: { left: string | null; arrived: string | null; out: string | null; back: string | null; backBy: string | null; returnKm: number | null }
  /** coordinator: may record "Back at hospital" by hand while it is missing */
  canSetBack?: boolean
  /** Settings → General has no hospital location: arrival is not detected automatically */
  noHospitalPin?: boolean
}) {
  const steps = [
    { k: 'Left', v: times.left },
    { k: 'Arrived', v: times.arrived },
    { k: 'Check-out', v: times.out },
    {
      k: 'Back at hospital',
      v: times.back,
      note: times.backBy === 'next_visit' ? 'went to next visit' : times.backBy === 'timeout' ? 'not recorded' : times.backBy === 'button' ? 'by button' : times.backBy === 'manual' ? 'set by coordinator' : times.backBy === 'geofence' ? 'auto (GPS)' : null,
    },
  ]
  const travelOut = mins(times.left, times.arrived)
  const visit = mins(times.arrived, times.out)
  const travelBack = mins(times.out, times.back)
  const total = mins(times.left, times.back)
  const title = initial.active ? (initial.phase === 'RETURN' ? `${staffName} is returning to the hospital` : `${staffName} is on the way`) : 'Trip'
  return (
    <section className="rounded-card bg-white p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-bold">{title}</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-slate-500">
          {travelOut != null && <span>Travel out {travelOut} min</span>}
          {visit != null && <span>Visit {visit} min</span>}
          {travelBack != null && <span>Travel back {travelBack} min{times.returnKm ? ` · ${times.returnKm} km` : ''}</span>}
          {total != null && <b className="text-slate-700">Total out {total} min</b>}
        </div>
      </div>
      <LiveMap url={`/requests/${requestId}/location`} initial={initial} staffName={staffName} poll={initial.active} height={300} />
      <ol className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s) => (
          <li key={s.k} className={cx('rounded-lg px-3 py-2', s.v ? 'bg-slate-50' : 'bg-white ring-1 ring-dashed ring-slate-200')}>
            <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-slate-500">{s.k}</div>
            <div className={cx('text-[15px] font-bold', !s.v && 'text-slate-300')}>{hm(s.v)}</div>
            {s.note && <div className="text-[11px] text-slate-500">{s.note}</div>}
            {s.k === 'Back at hospital' && !s.v && canSetBack && times.out && <SetBack requestId={requestId} after={times.out} />}
          </li>
        ))}
      </ol>
      {noHospitalPin && (
        <div className="mt-2 rounded-lg bg-[#FEF3C7] px-3 py-2 text-[12.5px] text-[#92400E]">
          The hospital location is not set, so &ldquo;Back at hospital&rdquo; is not detected automatically — staff tap <b>Reached hospital</b> on the app.{' '}
          <Link href="/settings" className="font-semibold underline">
            Set it in Settings → General
          </Link>
        </div>
      )}
    </section>
  )
}

/** "Back at hospital" by hand (missed tap / older visits): a time on the check-out day, after check-out. */
function SetBack({ requestId, after }: { requestId: string; after: string }) {
  const router = useRouter()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-0.5 text-[12px] font-semibold text-primary-700 hover:underline">
        Set time
      </button>
    )
  return (
    <div className="mt-1 flex items-center gap-1.5">
      <input type="time" className="hc-input h-8 w-[110px] px-2 text-[13px]" value={time} onChange={(e) => setTime(e.target.value)} aria-label="Back at hospital time" />
      <button
        type="button"
        disabled={busy || !time}
        className="inline-flex h-8 items-center rounded-lg bg-primary px-2.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
        onClick={async () => {
          setBusy(true)
          try {
            const day = new Date(after).toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' })
            await api(`/requests/${requestId}/back-at-hospital`, { body: { time, date: day } })
            toast(`Back at hospital · ${time}`, 'ok')
            router.refresh()
          } catch (e: any) {
            toast(e.message, 'err')
          } finally {
            setBusy(false)
          }
        }}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : 'Save'}
      </button>
    </div>
  )
}
