'use client'
import { useEffect, useState } from 'react'
import { CheckCircle2, Clock3, Loader2, Phone } from 'lucide-react'
import { api } from '@/components/client/api'
import { LiveMap, type LiveData } from '@/components/client/LiveMap'
import { telUrl } from '@/components/ui'

type Track = {
  requestNo: string
  state: 'on_the_way' | 'arrived' | 'ended' | 'cancelled'
  staff: { firstName: string; designation: string } | null
  hotline: string
  at: string | null
  point: { lat: number; lng: number } | null
  dest: { lat: number; lng: number } | null
  eta: { km: number; min: number } | null
}

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
    const id = setInterval(() => document.visibilityState === 'visible' && load(), 15_000)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [token])

  const live: LiveData | null = d && d.state === 'on_the_way' ? { active: true, phase: 'OUT', at: d.at, point: d.point, dest: d.dest, eta: d.eta } : null
  return (
    <main className="min-h-dvh bg-page px-4 py-5">
      <div className="mx-auto flex max-w-[520px] flex-col gap-3">
        <div className="flex items-center justify-between">
          <img src="/logo.svg" alt="Unico Hospitals" className="h-9" />
          {d && <span className="text-[12px] text-slate-500">{d.requestNo}</span>}
        </div>
        {!d && !err && (
          <div className="flex items-center justify-center gap-2 rounded-2xl bg-white p-8 text-slate-500 shadow-card">
            <Loader2 size={18} className="animate-spin" /> Loading…
          </div>
        )}
        {err && <div className="rounded-2xl bg-white p-6 text-center text-[15px] text-slate-600 shadow-card">This tracking link is not valid any more.</div>}
        {d && (
          <section className="rounded-2xl bg-white p-4 shadow-card">
            {d.state === 'on_the_way' ? (
              <>
                <h1 className="text-[20px] font-bold text-navy">{d.staff ? `${d.staff.firstName} is on the way` : 'Your care team is on the way'}</h1>
                {d.staff?.designation && <div className="text-[14px] text-slate-500">{d.staff.designation} · Unico Hospitals</div>}
                {d.eta && (
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full bg-primary-50 px-3 py-1.5 text-[15px] font-bold text-primary-700">
                    <Clock3 size={16} /> About {d.eta.min} min away · {d.eta.km} km
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3">
                <CheckCircle2 size={36} className="flex-none text-[#16A34A]" />
                <div>
                  <h1 className="text-[20px] font-bold text-navy">{d.state === 'arrived' ? 'Your care team has arrived' : d.state === 'cancelled' ? 'This visit was cancelled' : 'Live tracking has ended'}</h1>
                  <div className="text-[14px] text-slate-500">Thank you for choosing Unico Hospitals.</div>
                </div>
              </div>
            )}
          </section>
        )}
        {live && <LiveMap url={`/public/track/${token}`} initial={live} poll={false} showTrail={false} staffName={d?.staff?.firstName ?? 'Staff'} height={360} />}
        {d && (
          <a href={telUrl(d.hotline)} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-[16px] font-bold text-white">
            <Phone size={18} /> Call Unico Hospitals
          </a>
        )}
      </div>
    </main>
  )
}
