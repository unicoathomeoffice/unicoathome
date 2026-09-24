'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Check, Loader2, Plus, Settings2 } from 'lucide-react'
import { api, useAction, Sheet, Segmented } from '@/components/client'
import { cx } from '@/lib/format'
import { abtn, bbtn } from '@/components/coord/ui'

const OWN = [
  { value: 'RICKSHAW', label: 'Rickshaw' },
  { value: 'UBER', label: 'Uber' },
  { value: 'PATHAO', label: 'Pathao' },
  { value: 'OTHER', label: 'Other' },
] as const

/** "Own transport" quick action on a trip request card (S4). */
export function OwnTransportButton({ id, requestNo }: { id: string; requestNo: string }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<string>('UBER')
  const { run, busy } = useAction()
  return (
    <>
      <button type="button" className={abtn('o', 'flex-1')} onClick={() => setOpen(true)}>
        Own transport
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Own transport"
        sub={`${requestNo} · the team travels on their own; no car is booked`}
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className={bbtn('p', 'flex-[1.6]')}
              disabled={busy}
              onClick={async () => {
                const r = await run(() => api(`/requests/${id}/transport`, { body: { mode } }), `${requestNo} · own transport`)
                if (r) setOpen(false)
              }}
            >
              {busy && <Loader2 size={18} className="animate-spin" />}
              Save · {OWN.find((o) => o.value === mode)?.label}
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2">
          {OWN.map((o) => (
            <button key={o.value} type="button" onClick={() => setMode(o.value)} className={cx('h-12 rounded-xl text-[15px] font-bold', mode === o.value ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
              {o.label}
            </button>
          ))}
        </div>
      </Sheet>
    </>
  )
}

/** The one big action for the driver's current leg (D1). */
export function LegButton({ id, leg, label, className }: { id: string; leg: string; label: string; className?: string }) {
  const { run, busy } = useAction()
  return (
    <button type="button" disabled={busy} className={cx('flex h-[52px] flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-primary px-4 text-[16px] font-bold text-white active:bg-primary-700 disabled:opacity-60', className)} onClick={() => run(() => api(`/requests/${id}/transport-leg`, { body: { leg } }), `${label} · ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Asia/Dhaka', hour: '2-digit', minute: '2-digit' })}`)}>
      {busy && <Loader2 size={18} className="animate-spin" />}
      {label}
    </button>
  )
}

export type CarOpt = { id: string; name: string; plate: string; model?: string; seats?: number; driver: { id: string; name: string } | null; ok: boolean; label: string }

/** S4b — "Which car goes?" sheet body: Unico car vs own transport, cars with state, pick-up / return times. */
export function AssignCarForm({ id, requestNo, sub, cars, pickup, ret, currentVehicleId, initialMode }: { id: string; requestNo: string; sub: string; cars: CarOpt[]; pickup: string; ret: string; currentVehicleId?: string; initialMode: 'car' | 'own' }) {
  const [mode, setMode] = useState<'car' | 'own'>(initialMode)
  const firstOk = cars.find((c) => c.id === currentVehicleId) ?? cars.find((c) => c.ok && c.driver)
  const [car, setCar] = useState<string>(firstOk?.id ?? '')
  const [p, setP] = useState(pickup)
  const [r, setR] = useState(ret)
  const [own, setOwn] = useState<string>('UBER')
  const { run, busy } = useAction()
  const chosen = cars.find((c) => c.id === car)
  const label = mode === 'own' ? `Save · ${OWN.find((o) => o.value === own)?.label}` : chosen ? `Assign ${chosen.name}${chosen.driver ? ` · ${chosen.driver.name.split(' ')[0]}` : ''}` : 'Pick a car'
  return (
    <>
      <div>
        <div className="text-[20px] font-bold">Which car goes?</div>
        <div className="text-[13px] text-slate-500">{sub}</div>
      </div>
      <Segmented
        h={38}
        value={mode}
        onChange={setMode}
        items={[
          { value: 'car', label: 'Unico @ Home car' },
          { value: 'own', label: 'Own transport' },
        ]}
      />
      {mode === 'car' ? (
        <>
          <div className="overflow-hidden rounded-card border border-slate-200 bg-white">
            {cars.map((c, i) => {
              const on = c.id === car
              const disabled = !c.driver || c.label.startsWith('In service')
              return (
                <button key={c.id} type="button" disabled={disabled} onClick={() => setCar(c.id)} className={cx('flex w-full items-center gap-3 px-3.5 py-3 text-left', i > 0 && 'border-t border-slate-100', on && 'bg-primary-50', (!c.ok || disabled) && !on && 'opacity-50')}>
                  <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-full border-2', on ? 'border-primary' : 'border-slate-300')}>{on && <span className="size-2.5 rounded-full bg-primary" />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[15px] font-bold">
                      {c.name}{' '}
                      <span className="text-[12px] font-normal text-slate-500">
                        · {[c.plate, c.model, c.seats ? `${c.seats} seats` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                    <div className="text-[12px] text-slate-500">
                      {c.driver ? `Driver ${c.driver.name}` : 'No driver assigned'} · {c.label}
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
          {chosen && !chosen.ok && <div className="-mt-1 text-[12px] font-semibold text-[#B45309]">{chosen.name} has another trip in this window — check the times.</div>}
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Pick-up at hospital</div>
              <input type="time" className="hc-input hc-input-lg" value={p} onChange={(e) => setP(e.target.value)} />
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Return</div>
              <input type="time" className="hc-input hc-input-lg" value={r} onChange={(e) => setR(e.target.value)} />
            </div>
          </div>
          {chosen && (
            <div className="flex items-center gap-2 rounded-[10px] bg-slate-50 px-3 py-2.5 text-[13px]">
              <Check size={16} className="flex-none text-[#16A34A]" strokeWidth={3} />
              <span>
                <b>Notify</b> · driver and care team get “{chosen.name}
                {chosen.driver ? ` · ${chosen.driver.name.split(' ')[0]}` : ''} · {p}”
              </span>
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {OWN.map((o) => (
            <button key={o.value} type="button" onClick={() => setOwn(o.value)} className={cx('h-12 rounded-xl text-[15px] font-bold', own === o.value ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
              {o.label}
            </button>
          ))}
          <div className="col-span-2 text-[12px] text-slate-500">The team travels on their own and claims the fare as petty cash.</div>
        </div>
      )}
      <div className="flex gap-2.5">
        <Link href="/m/trips" className={bbtn('o', 'flex-1')}>
          Cancel
        </Link>
        <button
          type="button"
          disabled={busy || (mode === 'car' && !chosen)}
          className={bbtn('p', 'flex-[1.8]')}
          onClick={() =>
            run(
              () => api(`/requests/${id}/transport`, { body: mode === 'own' ? { mode: own } : { mode: 'UNICO_CAR', vehicleId: car, driverId: chosen?.driver?.id, pickupTime: p || undefined, returnTime: r || undefined } }),
              mode === 'own' ? `${requestNo} · own transport` : `${chosen?.name} assigned · driver notified`,
              { redirect: '/m/trips' },
            )
          }
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          {label}
        </button>
      </div>
    </>
  )
}

type Driver = { id: string; name: string; car?: string }
type CarEdit = { id: string; name: string; plate: string; model?: string; seats?: number; status: string; statusNote?: string; odometerKm?: number; fuelPct?: number; nextServiceKm?: number; serviceNote?: string; driverId?: string }

function CarFields({ v, set }: { v: Partial<CarEdit>; set: (x: Partial<CarEdit>) => void }) {
  const f = (k: keyof CarEdit, label: string, type = 'text', ph?: string) => (
    <div>
      <div className="mb-1.5 text-[13px] font-semibold text-slate-700">{label}</div>
      <input className="hc-input hc-input-lg" type={type} inputMode={type === 'number' ? 'numeric' : undefined} placeholder={ph} value={(v[k] as any) ?? ''} onChange={(e) => set({ [k]: e.target.value } as any)} />
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {f('name', 'Name', 'text', 'Car 5')}
      {f('plate', 'Plate', 'text', 'DHA-GA 00-0000')}
      {f('model', 'Model', 'text', 'Toyota Noah')}
      {f('seats', 'Seats', 'number')}
      {f('odometerKm', 'Odometer km', 'number')}
      {f('fuelPct', 'Fuel %', 'number')}
      {f('nextServiceKm', 'Next service at km', 'number')}
      {f('statusNote', 'Status note', 'text', 'e.g. back Sat')}
    </div>
  )
}

const num = (x: unknown) => (x === '' || x == null ? undefined : Number(x))
const carBody = (v: Partial<CarEdit>) => ({
  name: v.name?.trim(),
  plate: v.plate?.trim(),
  model: v.model?.trim() || undefined,
  seats: num(v.seats),
  odometerKm: num(v.odometerKm),
  fuelPct: num(v.fuelPct),
  nextServiceKm: num(v.nextServiceKm),
  statusNote: v.statusNote?.trim() || undefined,
})

/** D2 header "+" — add a car. */
export function AddCarButton() {
  const [open, setOpen] = useState(false)
  const [v, setV] = useState<Partial<CarEdit>>({})
  const { run, busy } = useAction()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex size-10 items-center justify-center text-primary" aria-label="Add car">
        <Plus size={24} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Add car"
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button
              className={bbtn('p', 'flex-[1.6]')}
              disabled={busy || !v.name || !v.plate}
              onClick={async () => {
                const r = await run(() => api('/master/vehicles', { body: { ...carBody(v), status: 'FREE' } }), `${v.name} added`)
                if (r) {
                  setOpen(false)
                  setV({})
                }
              }}
            >
              {busy && <Loader2 size={18} className="animate-spin" />}
              Add car
            </button>
          </>
        }
      >
        <CarFields v={v} set={(x) => setV({ ...v, ...x })} />
      </Sheet>
    </>
  )
}

/** Per-car actions on D2: assign driver, change status, edit details. */
export function CarActions({ car, drivers, label = 'Manage' }: { car: CarEdit; drivers: Driver[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'driver' | 'status' | 'edit'>(car.driverId ? 'status' : 'driver')
  const [driverId, setDriverId] = useState(car.driverId ?? '')
  const [status, setStatus] = useState(car.status)
  const [note, setNote] = useState(car.statusNote ?? '')
  const [v, setV] = useState<Partial<CarEdit>>(car)
  const { run, busy } = useAction()
  async function save() {
    let r: unknown
    if (tab === 'driver') r = await run(() => api(`/vehicles/${car.id}/driver`, { body: { driverId: driverId || null } }), driverId ? `Driver assigned to ${car.name}` : `Driver removed from ${car.name}`)
    else if (tab === 'status') r = await run(() => api(`/master/vehicles/${car.id}`, { method: 'PATCH', body: { status, statusNote: note.trim() || undefined } }), `${car.name} updated`)
    else r = await run(() => api(`/master/vehicles/${car.id}`, { method: 'PATCH', body: carBody(v) }), `${car.name} saved`)
    if (r) setOpen(false)
  }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex h-9 min-w-9 flex-none items-center justify-center gap-1 rounded-lg bg-slate-100 px-2 text-[13px] font-semibold text-primary-700" aria-label={`Manage ${car.name}`}>
        <Settings2 size={16} /> {label}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={car.name}
        sub={car.plate}
        footer={
          <>
            <button className={bbtn('o', 'flex-1')} onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className={bbtn('p', 'flex-[1.6]')} disabled={busy} onClick={save}>
              {busy && <Loader2 size={18} className="animate-spin" />}
              Save
            </button>
          </>
        }
      >
        <Segmented
          h={36}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'driver', label: 'Driver' },
            { value: 'status', label: 'Status' },
            { value: 'edit', label: 'Details' },
          ]}
        />
        <div className="mt-3">
          {tab === 'driver' && (
            <div className="overflow-hidden rounded-card border border-slate-200">
              {[{ id: '', name: 'No driver' } as Driver, ...drivers].map((d, i) => (
                <button key={d.id || 'none'} type="button" onClick={() => setDriverId(d.id)} className={cx('flex w-full items-center gap-3 px-3.5 py-3 text-left', i > 0 && 'border-t border-slate-100', driverId === d.id && 'bg-primary-50')}>
                  <span className={cx('flex size-[22px] flex-none items-center justify-center rounded-full border-2', driverId === d.id ? 'border-primary' : 'border-slate-300')}>{driverId === d.id && <span className="size-2.5 rounded-full bg-primary" />}</span>
                  <span className="flex-1 text-[15px] font-semibold">{d.name}</span>
                  {d.car && d.id !== car.driverId && <span className="text-[12px] text-slate-500">now on {d.car}</span>}
                </button>
              ))}
            </div>
          )}
          {tab === 'status' && (
            <div className="grid gap-3">
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ['FREE', 'Free'],
                    ['ON_TRIP', 'On trip'],
                    ['IN_SERVICE', 'In service'],
                  ] as const
                ).map(([s, l]) => (
                  <button key={s} type="button" onClick={() => setStatus(s)} className={cx('h-12 rounded-xl text-[14px] font-bold', status === s ? 'bg-primary text-white' : 'border-[1.5px] border-slate-300 bg-white text-slate-700')}>
                    {l}
                  </button>
                ))}
              </div>
              <input className="hc-input hc-input-lg" placeholder="Note, e.g. Toyota Uttara · back Sat" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
          {tab === 'edit' && <CarFields v={v} set={(x) => setV({ ...v, ...x })} />}
        </div>
      </Sheet>
    </>
  )
}

/** /m/vehicle — the driver updates odometer, fuel and a status note on their own car. */
export function DriverVehicleForm({ odometerKm, fuelPct, statusNote }: { odometerKm?: number; fuelPct?: number; statusNote?: string }) {
  const [odo, setOdo] = useState(odometerKm != null ? String(odometerKm) : '')
  const [fuel, setFuel] = useState(fuelPct ?? 50)
  const [note, setNote] = useState(statusNote ?? '')
  const { run, busy } = useAction()
  return (
    <div className="grid gap-3">
      <div>
        <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Odometer (km)</div>
        <input className="hc-input hc-input-lg text-[17px] font-bold" inputMode="numeric" value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ''))} />
      </div>
      <div>
        <div className="mb-1.5 flex justify-between text-[13px] font-semibold text-slate-700">
          <span>Fuel</span>
          <span className={fuel < 25 ? 'text-[#B91C1C]' : 'text-slate-900'}>{fuel}%</span>
        </div>
        <input type="range" min={0} max={100} step={5} value={fuel} onChange={(e) => setFuel(Number(e.target.value))} className="h-10 w-full accent-[#0090CA]" />
        <div className="grid grid-cols-5 gap-1.5">
          {[10, 25, 50, 75, 100].map((x) => (
            <button key={x} type="button" onClick={() => setFuel(x)} className={cx('h-9 rounded-lg text-[13px] font-bold', fuel === x ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600')}>
              {x === 100 ? 'Full' : `${x}%`}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[13px] font-semibold text-slate-700">Note for the supervisor</div>
        <input className="hc-input hc-input-lg" placeholder="e.g. AC weak, tyre pressure low" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <button
        type="button"
        disabled={busy}
        className={bbtn('p', 'w-full')}
        onClick={() => run(() => api('/vehicles/mine', { method: 'PATCH', body: { odometerKm: odo === '' ? undefined : Number(odo), fuelPct: fuel, statusNote: note.trim() } }), 'Car updated')}
      >
        {busy && <Loader2 size={18} className="animate-spin" />}
        Save readings
      </button>
    </div>
  )
}
