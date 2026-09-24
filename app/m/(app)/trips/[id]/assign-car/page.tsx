import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AssignCarForm } from '@/components/transport/actions'
import { requireTransport, fleet, availability } from '@/components/transport/data'
import { shortName } from '@/components/coord/ui'
import { dhakaParts } from '@/components/coord/data'
import { HomecareRequest, isOid } from '@/lib/models'
import { can } from '@/lib/constants'
import { withPeople } from '@/lib/services/requests'
import { isoDay, time, day } from '@/lib/format'
import { plain } from '@/lib/db'

export const metadata = { title: 'Assign car' }

/** S4b (5f) — "Which car goes?" sheet over the trips list. */
export default async function AssignCarPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const user = await requireTransport(false)
  if (!can(user, 'transport.manage')) redirect('/m/trips')
  const { id } = await params
  const sp = await searchParams
  if (!isOid(id)) notFound()
  const r = await HomecareRequest.findOne({ _id: id, deletedAt: null }).lean<any>()
  if (!r) notFound()
  if (['COMPLETED', 'CLOSED', 'CANCELLED'].includes(r.status)) redirect('/m/trips')
  await withPeople([r])
  const at = r.scheduledAt ? new Date(r.scheduledAt).getTime() : Date.now()
  const pickup = r.transport?.pickupAt ? new Date(r.transport.pickupAt).getTime() : at - 40 * 60_000
  const ret = r.transport?.returnAt ? new Date(r.transport.returnAt).getTime() : at + ((r.expectedDurationMin ?? 45) + 60) * 60_000
  const cars = await fleet(isoDay(r.scheduledAt ?? new Date()))
  const opts = cars.map((c) => {
    const a = availability(c, [pickup, ret], id)
    return { id: c.id, name: c.name, plate: c.plate, model: c.model, seats: c.seats, driver: c.driver ? { id: c.driver.id, name: c.driver.name } : null, ok: a.ok, label: a.label }
  })
  opts.sort((a, b) => Number(b.ok && !!b.driver) - Number(a.ok && !!a.driver))
  const team = [r.primaryStaff, ...(r.secondaryStaff ?? [])].filter(Boolean)
  const sub = `${r.requestNo} · ${day(r.scheduledAt)} ${time(r.scheduledAt)} · ${r.patientSnapshot?.area ?? ''}${team.length ? ` · pick up ${team.map((m: any) => shortName(m.name)).join(' + ')} at hospital ${time(pickup)}` : ''}`
  return (
    <div className="relative min-h-dvh bg-slate-100">
      <Link href="/m/trips" className="absolute inset-0 z-0 block bg-slate-900/45" aria-label="Close" />
      <div className="pointer-events-none relative z-0 px-5 pt-[max(14px,env(safe-area-inset-top))] opacity-60">
        <div className="text-[17px] font-bold text-white">Trips</div>
        <div className="text-[13px] text-white/80">{day(r.scheduledAt)}</div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-h-[92dvh] w-full max-w-[480px] flex-col gap-3.5 overflow-y-auto rounded-t-[20px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-2.5 shadow-sheet">
        <div className="mx-auto h-1 w-10 flex-none rounded-full bg-slate-300" />
        <AssignCarForm
          id={id}
          requestNo={r.requestNo}
          sub={sub}
          cars={plain(opts)}
          pickup={dhakaParts(new Date(pickup)).time}
          ret={dhakaParts(new Date(ret)).time}
          currentVehicleId={r.transport?.vehicleId ? String(r.transport.vehicleId) : undefined}
          initialMode={sp.mode === 'own' || r.transport?.status === 'OWN' ? 'own' : 'car'}
        />
      </div>
    </div>
  )
}
