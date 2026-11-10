'use client'
// /live: list of travelling teams + one map; refreshes every 10 s.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronRight, Clock3 } from 'lucide-react'
import { api } from '@/components/client'
import { LiveBoardMap } from '@/components/client/LiveMap'
import { cx } from '@/lib/format'

type Item = {
  id: string
  requestNo: string
  patient: string
  area: string
  service: string
  staff: string
  phase: 'OUT' | 'RETURN' | null
  at: string | null
  /** the phone's app left the screen after the last point */
  pausedAt?: string | null
  point: { lat: number; lng: number; heading?: number | null } | null
  dest: { lat: number; lng: number } | null
  eta: { km: number; min: number } | null
}

export function LiveBoard({ initial }: { initial: Item[] }) {
  const [items, setItems] = useState(initial)
  const [focus, setFocus] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(async () => {
      if (document.visibilityState !== 'visible') return
      try {
        setItems((await api<{ items: Item[] }>('/tracking/live')).items)
        setNow(Date.now())
      } catch {}
    }, 5_000)
    return () => clearInterval(id)
  }, [])
  const ago = (iso: string | null) => (iso ? Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000)) : null)
  const out = items.filter((i) => i.phase === 'OUT')
  const back = items.filter((i) => i.phase === 'RETURN')
  return (
    <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="flex flex-col gap-3">
        {[
          { title: `On the way to patients · ${out.length}`, rows: out },
          { title: `Returning to hospital · ${back.length}`, rows: back },
        ].map((g) => (
          <section key={g.title} className="rounded-card bg-white p-3 shadow-card">
            <h2 className="px-1 pb-2 text-[14px] font-bold">{g.title}</h2>
            {!g.rows.length && <div className="px-1 pb-1 text-[13px] text-slate-400">Nobody</div>}
            {g.rows.map((i) => {
              const m = ago(i.at)
              const lost = m == null || m >= 3
              const paused = lost && !!i.pausedAt
              return (
                <div key={i.id} className={cx('flex items-center gap-2 rounded-lg px-2 py-2', focus === i.id ? 'bg-primary-50' : 'hover:bg-slate-50')}>
                  <button type="button" onClick={() => setFocus((f) => (f === i.id ? null : i.id))} className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[14px] font-semibold">{i.staff || 'Staff'}</div>
                    <div className="truncate text-[12px] text-slate-500">
                      {i.requestNo} · {i.patient}
                      {i.area ? ` · ${i.area}` : ''}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
                      {i.eta && (
                        <span className="font-semibold text-navy">
                          <Clock3 size={12} className="mr-0.5 inline" />≈ {i.eta.min} min · {i.eta.km} km
                        </span>
                      )}
                      <span className={paused ? 'font-semibold text-[#B45309]' : lost ? 'font-semibold text-[#B91C1C]' : 'text-[#15803D]'}>
                        {paused ? `paused · left the app ${new Date(i.pausedAt!).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })}` : m == null ? 'no location yet' : lost ? `signal lost ${m} min` : m === 0 ? 'live' : `${m} min ago`}
                      </span>
                    </div>
                  </button>
                  <Link href={`/requests/${i.id}`} className="flex size-8 flex-none items-center justify-center rounded-lg text-slate-400 hover:bg-white hover:text-primary-700" aria-label="Open request">
                    <ChevronRight size={18} />
                  </Link>
                </div>
              )
            })}
          </section>
        ))}
      </div>
      <LiveBoardMap
        items={items.map((i) => {
          const m = ago(i.at)
          const state = i.phase === 'RETURN' ? 'return' : m == null || m >= 3 ? (i.pausedAt ? 'paused' : 'lost') : 'live'
          return { id: i.id, label: i.staff || 'Staff', sub: `${i.requestNo} · ${i.patient}`, point: i.point, phase: i.phase, at: i.at, dest: i.dest, state: state as 'live' | 'paused' | 'lost' | 'return' }
        })}
        focus={focus}
        onSelect={(id) => setFocus((f) => (f === id ? null : id))}
      />
    </div>
  )
}
