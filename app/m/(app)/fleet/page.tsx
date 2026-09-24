import { Car } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { AutoRefresh } from '@/components/client'
import { Chips, Empty } from '@/components/ui'
import { AddCarButton, CarActions } from '@/components/transport/actions'
import { requireTransport, fleet } from '@/components/transport/data'
import { User, Vehicle } from '@/lib/models'
import { can } from '@/lib/constants'
import { redirect } from 'next/navigation'
import { time, cx } from '@/lib/format'

export const metadata = { title: 'Fleet' }

const CHIP: Record<string, [string, string]> = { FREE: ['bg-[#DCFCE7] text-[#15803D]', 'Free'], ON_TRIP: ['bg-[#CFFAFE] text-[#0E7490]', 'On trip'], IN_SERVICE: ['bg-slate-100 text-slate-500', 'In service'] }
const km = (n?: number | null) => (n == null ? '—' : `${Math.round(n).toLocaleString('en-IN')} km`)

/** D2 (6b) Fleet — every car with state, driver, odometer, fuel and next service. */
export default async function FleetPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const user = await requireTransport(false)
  if (user.role === 'DRIVER') redirect('/m/vehicle')
  const sp = await searchParams
  const f = sp.f ?? 'all'
  const [cars, drivers, allCars] = await Promise.all([fleet(), User.find({ role: 'DRIVER', status: 'ACTIVE', deletedAt: null }).select('name availability').sort({ name: 1 }).lean<any[]>(), Vehicle.find({}).select('name driverId').lean<any[]>()])
  const list = cars.filter((c) => (f === 'free' ? c.state === 'FREE' : f === 'trip' ? c.state === 'ON_TRIP' : f === 'service' ? c.serviceDue : true))
  const onDuty = drivers.filter((d) => d.availability === 'ON_DUTY').length
  const driverOpts = drivers.map((d) => ({ id: String(d._id), name: d.name as string, car: allCars.find((v) => String(v.driverId) === String(d._id))?.name as string | undefined }))
  const manage = can(user, 'transport.manage')
  return (
    <MScreen title="Fleet" sub={`${cars.length} cars · ${onDuty} driver${onDuty === 1 ? '' : 's'} on duty`} right={manage ? <AddCarButton /> : undefined} tab={user.role === 'TRANSPORT_SUPERVISOR' ? 'fleet' : 'admin'} back={user.role === 'TRANSPORT_SUPERVISOR' ? undefined : '/m/trips'}>
      <AutoRefresh seconds={60} />
      <Chips
        active={f}
        items={[
          { key: 'all', label: 'All', href: '/m/fleet' },
          { key: 'free', label: 'Free', href: '/m/fleet?f=free' },
          { key: 'trip', label: 'On trip', href: '/m/fleet?f=trip' },
          { key: 'service', label: 'Service due', href: '/m/fleet?f=service' },
        ]}
      />
      {!list.length && <Empty icon={<Car size={26} />} title="No cars here" sub="Try another filter or add a car." />}
      {list.map((c) => {
        const [chipCls, chipLabel] = CHIP[c.state]
        const line = c.state === 'ON_TRIP' ? `On trip${c.current?.area ? ` · ${c.current.area}` : ''}${c.current?.back ? ` · back ~${time(c.current.back)}` : ''}` : c.state === 'IN_SERVICE' ? `In service${c.statusNote ? ` · ${c.statusNote}` : ''}` : `Free · at hospital${c.next?.pickupAt ? ` · next pick-up ${time(c.next.pickupAt)}` : ''}`
        return (
          <div key={c.id} className="rounded-card bg-white px-4 py-3.5 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[17px] font-bold">{c.name}</div>
                <div className="truncate text-[13px] text-slate-500">{[c.plate, c.model, c.seats ? `${c.seats} seats` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <span className={cx('inline-flex h-[22px] flex-none items-center rounded-full px-2 text-[10.5px] font-bold uppercase', chipCls)}>{chipLabel}</span>
            </div>
            <div className="mt-3 flex items-center gap-2.5 border-t border-slate-100 pt-3">
              {c.driver ? (
                <div className="flex size-8 flex-none items-center justify-center rounded-full bg-[#FFEDD5] text-[12px] font-bold text-[#C2410C]">
                  {c.driver.name
                    .split(' ')
                    .map((x) => x[0])
                    .slice(0, 2)
                    .join('')}
                </div>
              ) : (
                <div className="size-8 flex-none rounded-full border-[1.5px] border-dashed border-slate-300" />
              )}
              <div className="min-w-0 flex-1">
                <div className={cx('truncate text-[14px] font-semibold', !c.driver && 'text-primary-700')}>{c.driver?.name ?? 'No driver assigned'}</div>
                <div className="truncate text-[12px] text-slate-500">{line}</div>
              </div>
              {manage && (
                <CarActions
                  car={{ id: c.id, name: c.name, plate: c.plate, model: c.model, seats: c.seats, status: c.status, statusNote: c.statusNote, odometerKm: c.odometerKm, fuelPct: c.fuelPct, nextServiceKm: c.nextServiceKm, driverId: c.driver?.id }}
                  drivers={driverOpts}
                  label={c.driver ? '' : 'Assign driver'}
                />
              )}
            </div>
            <div className="mt-2.5 grid grid-cols-[1fr_0.85fr_1.4fr] gap-1.5 text-center text-[12px] font-semibold">
              <div className="rounded-md bg-slate-100 px-1 py-1.5">{km(c.odometerKm)}</div>
              <div className={cx('rounded-md px-1 py-1.5', c.fuelPct != null && c.fuelPct < 25 ? 'bg-[#FEE2E2] text-[#B91C1C]' : 'bg-slate-100')}>Fuel {c.fuelPct != null ? `${c.fuelPct}%` : '—'}</div>
              <div className={cx('whitespace-nowrap rounded-md px-1 py-1.5', c.serviceLeft != null && c.serviceLeft < 1000 ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-slate-100')}>
                {c.serviceLeft == null ? 'Service —' : c.serviceLeft <= 0 ? 'Service overdue' : `Service in ${km(c.serviceLeft)}`}
              </div>
            </div>
          </div>
        )
      })}
    </MScreen>
  )
}
