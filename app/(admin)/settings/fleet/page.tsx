import { Car, Fuel, Gauge, Phone, TriangleAlert } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { Vehicle, User, HomecareRequest, Department, Designation, Zone } from '@/lib/models'
import { AVAILABILITY_LABEL, can } from '@/lib/constants'
import { plain } from '@/lib/db'
import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Card, Kpi, Tag, telUrl } from '@/components/ui'
import { CarDrawerButton, DriverCarSelect, type FleetCar, type Person } from '@/components/admin-settings/FleetClient'
import { AddUserButton } from '@/components/people/StaffClient'
import type { StaffOptions } from '@/components/people/UserDrawer'
import { cx, date, dayRange, phone as fmtPhone } from '@/lib/format'

export const metadata = { title: 'Fleet & drivers · Unico HomeCare' }

const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  FREE: { label: 'FREE', cls: 'bg-[#DCFCE7] text-[#15803D]' },
  ON_TRIP: { label: 'ON TRIP', cls: 'bg-[#CFFAFE] text-[#0E7490]' },
  IN_SERVICE: { label: 'IN SERVICE', cls: 'bg-slate-200 text-slate-700' },
}
const SHIFT: Record<string, string> = { MORNING: 'Morning', EVENING: 'Evening', NIGHT: 'Night', FLEX: 'Flexible' }
const km = (n?: number) => (n == null ? '—' : `${n.toLocaleString('en-IN')} km`)

export default async function FleetPage() {
  const user = await requireWebUser('transport.manage')
  const canUsers = can(user, 'users.manage')
  const { start, end } = dayRange()
  const [cars, drivers, supervisors, trips, departments, designations, zones] = await Promise.all([
    Vehicle.find({}).sort({ isActive: -1, name: 1 }).lean<any[]>(),
    User.find({ role: 'DRIVER', deletedAt: null }).sort({ name: 1 }).lean<any[]>(),
    User.find({ role: 'TRANSPORT_SUPERVISOR', deletedAt: null }).select('name phone').lean<any[]>(),
    HomecareRequest.aggregate([
      { $match: { 'transport.driverId': { $ne: null }, scheduledAt: { $gte: start, $lt: end }, status: { $ne: 'CANCELLED' }, deletedAt: null } },
      { $group: { _id: '$transport.driverId', n: { $sum: 1 }, done: { $sum: { $cond: [{ $eq: ['$transport.status', 'DONE'] }, 1, 0] } } } },
    ]),
    Department.find({ isActive: { $ne: false } }).select('name').lean<any[]>(),
    Designation.find({ isActive: { $ne: false } }).select('title departmentId').lean<any[]>(),
    Zone.find({ isActive: true }).sort({ sortOrder: 1 }).select('name').lean<any[]>(),
  ])
  const active = cars.filter((c) => c.isActive !== false)
  const person = (id: unknown, list: any[]) => (id ? list.find((x) => String(x._id) === String(id)) : undefined)
  const carOfDriver = (d: any) => cars.find((c) => String(c.driverId) === String(d._id)) ?? person(d.vehicleId, cars)
  const soon = Date.now() + 90 * 86400_000
  const expiring = drivers.filter((d) => d.licenceExpiry && new Date(d.licenceExpiry).getTime() < soon)
  const overdue = (c: any) => c.nextServiceKm != null && c.odometerKm != null && c.odometerKm >= c.nextServiceKm
  const sup = supervisors[0]

  const carList: FleetCar[] = plain(cars.map((c) => ({ ...c, driverId: c.driverId ? String(c.driverId) : undefined })))
  const driverList: Person[] = plain(drivers.map((d) => ({ _id: d._id, name: d.name, phone: d.phone })))
  const supList: Person[] = plain(supervisors.map((d) => ({ _id: d._id, name: d.name, phone: d.phone })))
  const staffOptions: StaffOptions = plain({
    departments: departments.map((d) => ({ _id: d._id, name: d.name })),
    designations: designations.map((d) => ({ _id: d._id, title: d.title, departmentId: d.departmentId })),
    zones: zones.map((z) => z.name),
    vehicles: cars.map((v) => ({ _id: v._id, name: v.name, plate: v.plate, driverId: v.driverId })),
    supervisors: supList,
  })

  return (
    <AdminPage
      title="Fleet & drivers"
      crumbs="Settings"
      actions={
        <div className="hidden items-center gap-2 md:flex">
          <AddUserButton options={staffOptions} canManage={canUsers} presetRole="DRIVER" label="Add driver" kind="o" />
          <CarDrawerButton cars={carList} drivers={driverList} supervisors={supList} canUsers={canUsers} />
        </div>
      }
    >
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi dense n={active.length} label="Cars" />
        <Kpi dense n={active.filter((c) => c.status === 'FREE').length} label="Free now" color="#15803D" />
        <Kpi dense n={active.filter((c) => c.status === 'ON_TRIP').length} label="On trip" color="#0E7490" />
        <Kpi dense n={active.filter(overdue).length + active.filter((c) => c.status === 'IN_SERVICE').length} label="Service due / in" color="#B45309" />
        <Kpi dense n={drivers.length} label="Drivers" />
        <Kpi dense n={expiring.length} label="Licence expiring" color={expiring.length ? '#B91C1C' : '#0F172A'} sub="within 90 days" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card>
          <div className="mb-4 flex flex-wrap items-baseline gap-2">
            <div className="flex-1 text-[15px] font-bold">Cars · {cars.length}</div>
            {sup && (
              <div className="text-[12.5px] text-slate-500">
                Supervisor: {sup.name} · {fmtPhone(sup.phone)}
              </div>
            )}
          </div>
          {cars.length === 0 ? (
            <div className="rounded-card border-2 border-dashed border-slate-300 px-6 py-10 text-center text-[13px] text-slate-500">
              <Car className="mx-auto mb-2 text-slate-400" /> No cars yet — add the first car.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cars.map((c) => {
                const d = person(c.driverId, drivers)
                const st = STATUS_TONE[c.status] ?? STATUS_TONE.FREE
                const due = overdue(c)
                const t = d ? trips.find((x) => String(x._id) === String(d._id)) : undefined
                const fc = carList.find((x) => x._id === String(c._id))!
                return (
                  <div key={String(c._id)} className={cx('flex items-start gap-3.5 rounded-card border border-slate-200 p-4', c.isActive === false && 'opacity-60')}>
                    <div className="flex size-12 flex-none items-center justify-center rounded-[10px] bg-slate-100 text-[14px] font-bold text-slate-600">{(c.name ?? 'Car').replace(/^Car\s*/i, 'C') || 'C'}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[15px] font-bold">
                          {c.name} · {c.plate}
                        </span>
                        {c.isActive === false && <Tag>Inactive</Tag>}
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-slate-500">
                        {[c.model, c.seats ? `${c.seats} seats` : null, c.odometerKm != null ? km(c.odometerKm) : null].filter(Boolean).join(' · ')}
                        {c.nextServiceKm != null && (
                          <span className={cx(due && 'font-semibold text-[#B91C1C]')}>
                            {' '}
                            · service {due ? 'overdue' : `at ${km(c.nextServiceKm)} (${km(c.nextServiceKm - (c.odometerKm ?? 0))} left)`}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
                        {c.fuelPct != null && (
                          <span className={cx('inline-flex items-center gap-1', c.fuelPct < 25 && 'font-semibold text-[#B91C1C]')}>
                            <Fuel size={13} /> {c.fuelPct}%
                          </span>
                        )}
                        {(c.statusNote || c.serviceNote) && (
                          <span className="inline-flex items-center gap-1">
                            <Gauge size={13} /> {[c.statusNote, c.serviceNote].filter(Boolean).join(' · ')}
                          </span>
                        )}
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[13px]">
                        {d ? (
                          <>
                            <Avatar name={d.name} size={22} tone="amber" />
                            <span className="font-semibold">{d.name}</span>
                            <a href={telUrl(d.phone)} className="text-slate-500 hover:text-primary-700">
                              · {fmtPhone(d.phone)}
                            </a>
                            {t && <span className="text-slate-500">· {t.n} trip{t.n === 1 ? '' : 's'} today</span>}
                          </>
                        ) : (
                          <CarDrawerButton variant="link" car={fc} cars={carList} drivers={driverList} supervisors={supList} canUsers={canUsers} />
                        )}
                      </div>
                    </div>
                    <span className={cx('inline-flex h-[22px] flex-none items-center rounded-full px-2 text-[10.5px] font-bold', st.cls)}>{st.label}</span>
                    <CarDrawerButton variant="icon" car={fc} cars={carList} drivers={driverList} supervisors={supList} canUsers={canUsers} />
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        <Card className="self-start">
          <div className="mb-1 flex items-center gap-2">
            <div className="flex-1 text-[15px] font-bold">Drivers · {drivers.length}</div>
            <div className="md:hidden">
              <AddUserButton options={staffOptions} canManage={canUsers} presetRole="DRIVER" label="Add driver" kind="o" />
            </div>
          </div>
          <div className="mb-3 text-[12.5px] text-slate-500">Each driver is a user with role DRIVER · change the car to re-link</div>
          {drivers.length === 0 && <div className="py-8 text-center text-[13px] text-slate-400">No drivers yet</div>}
          <div className="flex flex-col divide-y divide-slate-100">
            {drivers.map((d) => {
              const car = carOfDriver(d)
              const t = trips.find((x) => String(x._id) === String(d._id))
              const exp = d.licenceExpiry ? new Date(d.licenceExpiry) : null
              const expSoon = exp && exp.getTime() < soon
              return (
                <div key={String(d._id)} className="flex items-start gap-3 py-3">
                  <Avatar name={d.name} size={36} tone="amber" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 text-[14px]">
                      <span className="font-semibold">{d.name}</span>
                      <a href={telUrl(d.phone)} className="inline-flex items-center gap-1 text-[12.5px] text-slate-500 hover:text-primary-700">
                        <Phone size={12} /> {fmtPhone(d.phone)}
                      </a>
                      {d.status !== 'ACTIVE' && <Tag tone={d.status === 'PENDING' ? 'amber' : 'red'}>{d.status === 'PENDING' ? 'Awaiting approval' : 'Suspended'}</Tag>}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-slate-500">
                      {SHIFT[d.shift] ?? 'Morning'} shift · licence {d.licenceNo ?? '—'}
                      {exp && (
                        <span className={cx(expSoon && 'font-semibold text-[#B91C1C]')}>
                          {' '}
                          · exp {date(exp)}
                          {expSoon && <TriangleAlert size={12} className="ml-1 inline" />}
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <DriverCarSelect driverId={String(d._id)} carId={car ? String(car._id) : undefined} cars={carList} canUsers={canUsers} />
                      <Tag tone={d.availability === 'ON_DUTY' ? 'green' : d.availability === 'ON_LEAVE' ? 'amber' : 'slate'}>{AVAILABILITY_LABEL[d.availability as keyof typeof AVAILABILITY_LABEL] ?? '—'}</Tag>
                    </div>
                  </div>
                  <div className="flex-none text-right">
                    <div className="text-[20px] font-bold leading-none">{t?.n ?? 0}</div>
                    <div className="text-[11px] text-slate-500">trips today</div>
                    {t && t.done > 0 && <div className="text-[11px] text-[#15803D]">{t.done} done</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </AdminPage>
  )
}
