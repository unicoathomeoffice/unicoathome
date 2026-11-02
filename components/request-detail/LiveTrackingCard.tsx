'use client'
// Request page: where the team is right now (live map + ETA) and the whole trip — left, arrived, check-out, back.
import { LiveMap, type LiveData } from '@/components/client/LiveMap'
import { cx } from '@/lib/format'

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }) : '—')
const mins = (a: string | null, b: string | null) => (a && b ? Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 60000)) : null)

export function LiveTrackingCard({
  requestId,
  initial,
  staffName,
  times,
}: {
  requestId: string
  initial: LiveData
  staffName: string
  times: { left: string | null; arrived: string | null; out: string | null; back: string | null; backBy: string | null; returnKm: number | null }
}) {
  const steps = [
    { k: 'Left', v: times.left },
    { k: 'Arrived', v: times.arrived },
    { k: 'Check-out', v: times.out },
    { k: 'Back at hospital', v: times.back, note: times.backBy === 'next_visit' ? 'went to next visit' : times.backBy === 'timeout' ? 'not recorded' : times.backBy === 'button' ? 'by button' : null },
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
          </li>
        ))}
      </ol>
    </section>
  )
}
