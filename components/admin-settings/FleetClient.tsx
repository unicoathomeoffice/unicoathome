'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Car, Loader2, Pencil, Plus } from 'lucide-react'
import { api, Drawer, Toggle, useToast } from '@/components/client'
import { btnClass } from '@/components/ui'
import { Field, FormError, useFieldErrors } from '@/components/people/form'
import { VEHICLE_STATUSES } from '@/lib/constants'

export type FleetCar = {
  _id: string
  name?: string
  plate: string
  model?: string
  seats?: number
  status?: string
  statusNote?: string
  driverId?: string
  supervisorId?: string
  odometerKm?: number
  fuelPct?: number
  nextServiceKm?: number
  serviceNote?: string
  isActive?: boolean
}
export type Person = { _id: string; name: string; phone?: string }

const STATUS_LABEL: Record<string, string> = { FREE: 'Free', ON_TRIP: 'On trip', IN_SERVICE: 'In service' }

/**
 * Link driver ↔ car. The car's driverId is the source of truth (PATCH master/vehicles);
 * the driver's vehicleId is kept in sync when the current user may edit users.
 */
async function linkDriver(driverId: string, carId: string, cars: FleetCar[], canUsers: boolean) {
  for (const c of cars) if (c.driverId === driverId && c._id !== carId) await api(`/master/vehicles/${c._id}`, { method: 'PATCH', body: { driverId: '' } })
  if (carId) {
    const car = cars.find((c) => c._id === carId)
    if (car?.driverId && car.driverId !== driverId && canUsers) await api(`/users/${car.driverId}`, { method: 'PATCH', body: { vehicleId: '' } }).catch(() => {})
    await api(`/master/vehicles/${carId}`, { method: 'PATCH', body: { driverId } })
  }
  if (canUsers) await api(`/users/${driverId}`, { method: 'PATCH', body: { vehicleId: carId } })
}

/** Inline car picker on a driver row */
export function DriverCarSelect({ driverId, carId, cars, canUsers }: { driverId: string; carId?: string; cars: FleetCar[]; canUsers: boolean }) {
  const router = useRouter()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  return (
    <span className="flex items-center gap-1.5">
      {busy && <Loader2 size={14} className="animate-spin text-primary" />}
      <select
        aria-label="Assigned car"
        className="h-8 max-w-[190px] rounded-lg border border-slate-300 bg-white px-2 text-[12.5px] outline-none focus:border-primary"
        value={carId ?? ''}
        disabled={busy}
        onChange={async (e) => {
          setBusy(true)
          try {
            await linkDriver(driverId, e.target.value, cars, canUsers)
            toast(e.target.value ? 'Driver linked to car' : 'Driver unlinked')
            router.refresh()
          } catch (err: any) {
            toast(err?.message ?? 'Failed', 'err')
          } finally {
            setBusy(false)
          }
        }}
      >
        <option value="">No car</option>
        {cars.map((c) => (
          <option key={c._id} value={c._id}>
            {c.name ?? c.plate} · {c.plate}
          </option>
        ))}
      </select>
    </span>
  )
}

export function CarDrawerButton({ car, cars, drivers, supervisors, canUsers, variant = 'button' }: { car?: FleetCar; cars: FleetCar[]; drivers: Person[]; supervisors: Person[]; canUsers: boolean; variant?: 'button' | 'icon' | 'link' }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'icon' ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex size-8 flex-none items-center justify-center rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50" aria-label={`Edit ${car?.name ?? 'car'}`}>
          <Pencil size={15} />
        </button>
      ) : variant === 'link' ? (
        <button type="button" onClick={() => setOpen(true)} className="text-[13px] font-semibold text-primary-700">
          + Assign driver
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className={btnClass('p')}>
          <Plus size={16} /> Add car
        </button>
      )}
      {open && <CarDrawer car={car} cars={cars} drivers={drivers} supervisors={supervisors} canUsers={canUsers} onClose={() => setOpen(false)} />}
    </>
  )
}

function CarDrawer({ car, cars, drivers, supervisors, canUsers, onClose }: { car?: FleetCar; cars: FleetCar[]; drivers: Person[]; supervisors: Person[]; canUsers: boolean; onClose: () => void }) {
  const router = useRouter()
  const toast = useToast()
  const fe = useFieldErrors()
  const [busy, setBusy] = useState(false)
  const s = (x: unknown) => (x == null ? '' : String(x))
  const [v, setV] = useState({
    name: s(car?.name ?? `Car ${cars.length + 1}`),
    plate: s(car?.plate),
    model: s(car?.model),
    seats: s(car?.seats),
    status: s(car?.status ?? 'FREE'),
    statusNote: s(car?.statusNote),
    driverId: s(car?.driverId),
    supervisorId: s(car?.supervisorId ?? supervisors[0]?._id),
    odometerKm: s(car?.odometerKm),
    fuelPct: s(car?.fuelPct),
    nextServiceKm: s(car?.nextServiceKm),
    serviceNote: s(car?.serviceNote),
    isActive: car?.isActive !== false,
  })
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }))
  const err = (k: string) => fe.errors[k]

  async function save() {
    fe.clear()
    setBusy(true)
    const num = (x: string) => (x.trim() === '' ? undefined : Number(x))
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      plate: v.plate.trim(),
      model: v.model.trim() || (car ? '' : undefined),
      seats: num(v.seats),
      status: v.status,
      statusNote: v.statusNote.trim() || (car ? '' : undefined),
      supervisorId: v.supervisorId || (car ? '' : undefined),
      odometerKm: num(v.odometerKm),
      fuelPct: num(v.fuelPct),
      nextServiceKm: num(v.nextServiceKm),
      serviceNote: v.serviceNote.trim() || (car ? '' : undefined),
      isActive: v.isActive,
    }
    for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k]
    try {
      let id = car?._id
      if (car) await api(`/master/vehicles/${car._id}`, { method: 'PATCH', body })
      else id = (await api<{ id: string }>('/master/vehicles', { body })).id
      if ((car?.driverId ?? '') !== v.driverId) {
        if (v.driverId) await linkDriver(v.driverId, id!, [...cars.filter((c) => c._id !== id), { ...(car ?? { plate: v.plate }), _id: id!, driverId: car?.driverId }], canUsers)
        else if (car?.driverId) {
          await api(`/master/vehicles/${id}`, { method: 'PATCH', body: { driverId: '' } })
          if (canUsers) await api(`/users/${car.driverId}`, { method: 'PATCH', body: { vehicleId: '' } }).catch(() => {})
        }
      }
      toast(car ? 'Car saved' : 'Car added')
      onClose()
      router.refresh()
    } catch (e) {
      fe.fromError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      width={560}
      title={car ? `Edit ${car.name ?? car.plate}` : 'Add car'}
      sub="Cars are assigned to trips by the car supervisor"
      footer={
        <>
          <div className="flex-1" />
          <button className={btnClass('o')} onClick={onClose}>
            Cancel
          </button>
          <button className={btnClass('p')} disabled={busy} onClick={save}>
            {busy && <Loader2 size={16} className="animate-spin" />} {car ? 'Save car' : 'Add car'}
          </button>
        </>
      }
    >
      <FormError message={fe.message} />
      <div className="grid grid-cols-2 gap-x-3 gap-y-3.5">
        <Field label="Name" error={err('name')}>
          <input className="hc-input" value={v.name} onChange={set('name')} placeholder="Car 5" />
        </Field>
        <Field label="Number plate" error={err('plate')}>
          <input className="hc-input" value={v.plate} onChange={set('plate')} placeholder="DHA-GA 11-2233" />
        </Field>
        <Field label="Model" error={err('model')}>
          <input className="hc-input" value={v.model} onChange={set('model')} placeholder="Toyota Noah" />
        </Field>
        <Field label="Seats" error={err('seats')}>
          <input className="hc-input" inputMode="numeric" value={v.seats} onChange={set('seats')} />
        </Field>
        <Field label="Status" error={err('status')}>
          <select className="hc-input" value={v.status} onChange={set('status')}>
            {VEHICLE_STATUSES.map((x) => (
              <option key={x} value={x}>
                {STATUS_LABEL[x]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status note" error={err('statusNote')}>
          <input className="hc-input" value={v.statusNote} onChange={set('statusNote')} placeholder="At Toyota Uttara · back Sat" />
        </Field>
        <Field label="Driver" error={err('driverId')}>
          <select className="hc-input" value={v.driverId} onChange={set('driverId')}>
            <option value="">No driver</option>
            {drivers.map((d) => {
              const other = cars.find((c) => c.driverId === d._id && c._id !== car?._id)
              return (
                <option key={d._id} value={d._id}>
                  {d.name}
                  {other ? ` (now on ${other.name ?? other.plate})` : ''}
                </option>
              )
            })}
          </select>
        </Field>
        <Field label="Supervisor" error={err('supervisorId')}>
          <select className="hc-input" value={v.supervisorId} onChange={set('supervisorId')}>
            <option value="">—</option>
            {supervisors.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Odometer (km)" error={err('odometerKm')}>
          <input className="hc-input" inputMode="numeric" value={v.odometerKm} onChange={set('odometerKm')} />
        </Field>
        <Field label="Fuel (%)" error={err('fuelPct')}>
          <input className="hc-input" inputMode="numeric" value={v.fuelPct} onChange={set('fuelPct')} />
        </Field>
        <Field label="Next service at (km)" error={err('nextServiceKm')}>
          <input className="hc-input" inputMode="numeric" value={v.nextServiceKm} onChange={set('nextServiceKm')} />
        </Field>
        <Field label="Service note" error={err('serviceNote')}>
          <input className="hc-input" value={v.serviceNote} onChange={set('serviceNote')} placeholder="Oil + brakes" />
        </Field>
        <div className="col-span-2 flex items-center justify-between rounded-lg bg-slate-50 px-3.5 py-2.5 text-sm">
          <span>
            <span className="font-semibold">In the fleet</span>
            <span className="block text-[12px] text-slate-500">Inactive cars are hidden from trip assignment</span>
          </span>
          <Toggle on={v.isActive} onChange={(isActive) => setV((x) => ({ ...x, isActive }))} label="Active" />
        </div>
        {!canUsers && (
          <div className="col-span-2 flex items-start gap-2 text-[12px] text-slate-500">
            <Car size={14} className="mt-0.5 flex-none" /> The car’s driver is updated here; a super admin keeps the driver’s own profile in sync.
          </div>
        )}
      </div>
    </Drawer>
  )
}
