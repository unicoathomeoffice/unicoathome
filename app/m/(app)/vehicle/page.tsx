import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Car, Phone } from 'lucide-react'
import { MScreen, MCard } from '@/components/mobile'
import { Empty, Tag, telUrl } from '@/components/ui'
import { SLabel } from '@/components/coord/ui'
import { Line } from '@/components/coord/blocks'
import { DriverVehicleForm } from '@/components/transport/actions'
import { requireTransport } from '@/components/transport/data'
import { User, Vehicle, HomecareRequest } from '@/lib/models'
import { date, ago } from '@/lib/format'

export const metadata = { title: 'My vehicle' }

/** Driver tab "Vehicle": their car, supervisor, and odometer / fuel updates (PATCH /api/v1/vehicles/mine). */
export default async function VehiclePage() {
  const user = await requireTransport()
  if (user.role !== 'DRIVER') redirect('/m/fleet')
  const me = await User.findById(user.id).select('vehicleId supervisorId licenceNo licenceExpiry').lean<any>()
  const v = (await Vehicle.findOne({ driverId: user.id }).lean<any>()) ?? (me?.vehicleId ? await Vehicle.findById(me.vehicleId).lean<any>() : null)
  const sup = v?.supervisorId || me?.supervisorId ? await User.findById(v?.supervisorId ?? me?.supervisorId).select('name phone').lean<any>() : null
  const lastTrip = v ? await HomecareRequest.findOne({ 'transport.vehicleId': v._id, 'transport.status': 'DONE' }).sort({ scheduledAt: -1 }).select('requestNo scheduledAt patientSnapshot.area').lean<any>() : null
  const left = v?.nextServiceKm != null && v?.odometerKm != null ? v.nextServiceKm - v.odometerKm : null
  return (
    <MScreen title="My vehicle" sub={v ? `${v.name} · ${v.plate}` : 'No car assigned'} tab="vehicle">
      {!v ? (
        <Empty icon={<Car size={26} />} title="No car assigned to you" sub="Ask the car supervisor to assign you a car." />
      ) : (
        <>
          <MCard>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="text-[20px] font-bold">{v.name}</div>
                <div className="text-[13px] text-slate-500">{[v.plate, v.model, v.seats ? `${v.seats} seats` : ''].filter(Boolean).join(' · ')}</div>
              </div>
              <Tag tone={v.status === 'FREE' ? 'green' : v.status === 'ON_TRIP' ? 'blue' : 'slate'}>{v.status === 'FREE' ? 'FREE' : v.status === 'ON_TRIP' ? 'ON TRIP' : 'IN SERVICE'}</Tag>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-1.5 text-center text-[12px] font-semibold">
              <div className="rounded-md bg-slate-100 py-1.5">{v.odometerKm != null ? `${v.odometerKm.toLocaleString('en-IN')} km` : '—'}</div>
              <div className={v.fuelPct != null && v.fuelPct < 25 ? 'rounded-md bg-[#FEE2E2] py-1.5 text-[#B91C1C]' : 'rounded-md bg-slate-100 py-1.5'}>Fuel {v.fuelPct ?? '—'}%</div>
              <div className={left != null && left < 1000 ? 'rounded-md bg-[#FEF3C7] py-1.5 text-[#B45309]' : 'rounded-md bg-slate-100 py-1.5'}>{left == null ? 'Service —' : left <= 0 ? 'Service overdue' : `Service in ${left.toLocaleString('en-IN')} km`}</div>
            </div>
            {v.statusNote && <div className="mt-2 text-[13px] text-slate-600">Note: {v.statusNote}</div>}
            <div className="mt-1 text-[12px] text-slate-400">Updated {ago(v.updatedAt)}</div>
          </MCard>
          <SLabel>Update readings</SLabel>
          <MCard>
            <DriverVehicleForm odometerKm={v.odometerKm} fuelPct={v.fuelPct} statusNote={v.statusNote} />
          </MCard>
          <SLabel>Details</SLabel>
          <MCard>
            {v.serviceNote && <Line k="Service" v={v.serviceNote} />}
            {me?.licenceNo && <Line k="Licence" v={`${me.licenceNo}${me.licenceExpiry ? ` · until ${date(me.licenceExpiry)}` : ''}`} />}
            {lastTrip && <Line k="Last trip" v={`${lastTrip.requestNo} · ${lastTrip.patientSnapshot?.area ?? ''}`} />}
            {sup && (
              <div className="flex items-center gap-3 pt-2">
                <div className="min-w-0 flex-1 text-[14px]">
                  <div className="text-slate-500">Car supervisor</div>
                  <div className="font-semibold">{sup.name}</div>
                </div>
                <a href={telUrl(sup.phone)} className="flex h-10 items-center gap-1.5 rounded-[10px] bg-slate-100 px-3.5 text-[14px] font-semibold text-primary-700">
                  <Phone size={16} /> Call
                </a>
              </div>
            )}
          </MCard>
          <Link href="/m/trips" className="text-center text-[13px] font-semibold text-primary-700">
            Back to today’s trips
          </Link>
        </>
      )}
    </MScreen>
  )
}
