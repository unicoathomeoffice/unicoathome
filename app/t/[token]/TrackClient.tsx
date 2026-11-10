'use client'
// The patient's live tracking page, ride-hailing style: a full-screen map that follows the care team along the road,
// and a bottom card with the ETA, who is coming (photo, name, designation), the hospital car and plate, the steps of
// the visit, and buttons to call or WhatsApp the hospital. Refreshes every 5 s while the team is on the way.
import { useEffect, useState } from 'react'
import { Car, Check, CheckCircle2, Clock3, Loader2, MessageCircle, Phone, XCircle } from 'lucide-react'
import { api } from '@/components/client/api'
import { LiveMap, type LiveData } from '@/components/client/LiveMap'
import { telUrl } from '@/components/ui'
import { cx } from '@/lib/format'

type Track = {
  state: 'on_the_way' | 'arrived' | 'done' | 'ended' | 'cancelled'
  staff: { firstName: string; designation: string; photo: string | null; others: number } | null
  car: { name: string; plate: string; driver: string | null } | null
  service: string
  hotline: string
  hospital: string
  steps: { startedAt: string | null; arrivedAt: string | null; doneAt: string | null }
  at: string | null
  pausedAt: string | null
  point: { lat: number; lng: number; heading: number | null } | null
  dest: { lat: number; lng: number } | null
  eta: { km: number; min: number } | null
  route: [number, number][] | null
  speedKmh: number | null
}

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' }) : '')
const arriveBy = (min: number) => new Date(Date.now() + min * 60_000).toLocaleTimeString('en-US', { timeZone: 'Asia/Dhaka', hour: 'numeric', minute: '2-digit' })
const wa = (phone: string) => `https://wa.me/${phone.replace(/\D/g, '').replace(/^0/, '880')}`

export function TrackClient({ token }: { token: string }) {
  const [d, setD] = useState<Track | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let live = true
    const load = () =>
      api<Track>(`/public/track/${token}`)
        .then((x) => live && setD(x))
        .catch((e) => live && setErr(e.message))
    load()
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 5_000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [token])

  const onTheWay = d?.state === 'on_the_way'
  const live: LiveData | null = d && onTheWay ? { active: true, phase: 'OUT', at: d.at, pausedAt: d.pausedAt, point: d.point, dest: d.dest, eta: d.eta, route: d.route, speedKmh: d.speedKmh } : null
  const name = d?.staff?.firstName || 'Your care team'

  if (err)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-page p-6">
        <div className="max-w-sm rounded-2xl bg-white p-6 text-center text-[15px] text-slate-600 shadow-card">This tracking link is not valid any more.</div>
      </main>
    )
  if (!d)
    return (
      <main className="flex min-h-dvh items-center justify-center bg-page text-slate-500">
        <Loader2 size={20} className="mr-2 animate-spin" /> Loading…
      </main>
    )

  return (
    <main className="relative flex min-h-dvh flex-col bg-page">
      <header className="absolute inset-x-0 top-0 z-[600] flex items-center justify-between px-4 pt-3">
        <img src="/logo.svg" alt="Unico Hospitals" className="h-9 rounded-lg bg-white/90 px-2 py-1 shadow" />
      </header>

      {live ? (
        <div className="h-[58dvh] min-h-[320px]">
          <LiveMap url={`/public/track/${token}`} initial={live} poll={false} showTrail={false} staffName={name} height="100%" follow />
        </div>
      ) : (
        <div className="h-24" />
      )}

      <section className={cx('relative z-[550] mx-auto flex w-full max-w-[560px] flex-1 flex-col gap-3 rounded-t-3xl bg-white px-5 pb-6 pt-4 shadow-[0_-8px_24px_rgba(15,23,42,.12)]', live && '-mt-6')}>
        <div className="mx-auto h-1.5 w-10 rounded-full bg-slate-200" />

        {onTheWay ? (
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[.06em] text-primary-700">On the way</div>
            {d.eta ? (
              <>
                <div className="text-[28px] font-bold leading-tight text-navy">Arriving in {d.eta.min} min</div>
                <div className="text-[14px] text-slate-500">
                  About {arriveBy(d.eta.min)} · {d.eta.km} km away
                </div>
              </>
            ) : (
              <div className="text-[24px] font-bold text-navy">{name} is on the way</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3">
            {d.state === 'cancelled' ? <XCircle size={38} className="flex-none text-[#DC2626]" /> : <CheckCircle2 size={38} className="flex-none text-[#16A34A]" />}
            <div>
              <div className="text-[20px] font-bold text-navy">{d.state === 'arrived' ? 'Your care team has arrived' : d.state === 'done' ? 'Your visit is complete' : d.state === 'cancelled' ? 'This visit was cancelled' : 'Live tracking has ended'}</div>
              <div className="text-[14px] text-slate-500">Thank you for choosing {d.hospital || 'Unico Hospitals'}.</div>
            </div>
          </div>
        )}

        {d.staff && (
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            {d.staff.photo ? (
              <img src={d.staff.photo} alt="" className="size-14 flex-none rounded-full object-cover ring-2 ring-white" />
            ) : (
              <span className="flex size-14 flex-none items-center justify-center rounded-full bg-primary text-[20px] font-bold text-white">{name[0]}</span>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-bold text-slate-900">{d.staff.firstName}</div>
              <div className="text-[13.5px] text-slate-500">
                {[d.staff.designation, d.service].filter(Boolean).join(' · ')}
                {d.staff.others ? ` · with ${d.staff.others} more` : ''}
              </div>
            </div>
          </div>
        )}

        {d.car && (
          <div className="flex items-center gap-3 rounded-2xl bg-slate-50 p-3">
            <span className="flex size-11 flex-none items-center justify-center rounded-xl bg-navy text-white">
              <Car size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-bold">{d.car.name}</div>
              <div className="text-[13px] text-slate-500">{d.car.driver ? `Driver ${d.car.driver}` : 'Hospital car'}</div>
            </div>
            {d.car.plate && <span className="rounded-lg border-2 border-slate-800 bg-white px-2 py-1 font-mono text-[13px] font-bold tracking-wide text-slate-800">{d.car.plate}</span>}
          </div>
        )}

        <ol className="flex items-start justify-between px-1">
          {[
            { k: 'On the way', at: d.steps.startedAt },
            { k: 'Arrived', at: d.steps.arrivedAt },
            { k: 'Visit done', at: d.steps.doneAt },
          ].map((s, i) => (
            <li key={s.k} className="flex flex-1 flex-col items-center text-center">
              <span className={cx('flex size-7 items-center justify-center rounded-full', s.at ? 'bg-[#16A34A] text-white' : i === 1 && onTheWay ? 'bg-primary-50 text-primary-700 ring-2 ring-primary' : 'bg-slate-100 text-slate-400')}>
                {s.at ? <Check size={15} strokeWidth={3} /> : <Clock3 size={14} />}
              </span>
              <span className={cx('mt-1 text-[12.5px] font-semibold', s.at ? 'text-slate-800' : 'text-slate-400')}>{s.k}</span>
              <span className="text-[11.5px] text-slate-500">{hm(s.at)}</span>
            </li>
          ))}
        </ol>

        <div className="mt-auto grid grid-cols-2 gap-2.5 pt-1">
          <a href={telUrl(d.hotline)} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[15px] font-bold text-white">
            <Phone size={18} /> Call hospital
          </a>
          <a href={wa(d.hotline)} target="_blank" rel="noreferrer" className="flex h-12 items-center justify-center gap-2 rounded-xl border-[1.5px] border-[#16A34A] text-[15px] font-bold text-[#15803D]">
            <MessageCircle size={18} /> WhatsApp
          </a>
        </div>
      </section>
    </main>
  )
}
