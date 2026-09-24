import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Bell, FileText, MapPin, Navigation, Pencil, Phone, Plus, CalendarX2 } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { AutoRefresh, UnreadBadge } from '@/components/client'
import { Avatar, Empty, mapsUrl, telUrl } from '@/components/ui'
import { VisitCard, SectionLabel, svcName, ageG, vHref } from '@/components/field'
import { AvailabilitySeg, InMin } from '@/components/field/home'
import { RespondInline } from '@/components/field/visit'
import { SyncBanner } from '@/components/field/live'
import { teamFilter, isDesk } from '@/components/field/data'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { HomecareRequest, Note, Notification } from '@/lib/models'
import { withPeople } from '@/lib/services/requests'
import { can } from '@/lib/constants'
import { cx, dayRange, time } from '@/lib/format'

export const metadata = { title: 'Today' }

const ACTIVE = ['ASSIGNED', 'ACCEPTED', 'EN_ROUTE', 'IN_PROGRESS']

/** M03 Home (v2 · 3a) */
export default async function Home() {
  const user = await requireAppUser()
  if (user.role === 'DRIVER' || user.role === 'TRANSPORT_SUPERVISOR') redirect('/m/trips')
  await db()
  const desk = isDesk(user.role)
  const mine = teamFilter(user)
  const { start, end } = dayRange()
  const todayFilter: any = { deletedAt: null, scheduledAt: { $gte: start, $lt: end }, status: { $nin: ['CANCELLED', 'NEW', 'VERIFIED'] } }
  if (!desk) Object.assign(todayFilter, mine)

  const [today, next, awaiting, notes, unread] = await Promise.all([
    HomecareRequest.find(todayFilter).select('-visit.notes -deviceStamps -clinical.notes').sort({ scheduledAt: 1 }).limit(60).lean<any[]>(),
    HomecareRequest.find({ deletedAt: null, ...mine, status: { $in: ACTIVE }, scheduledAt: { $gte: new Date(start.getTime() - 86400_000) } })
      .select('requestNo status scheduledAt patientSnapshot services expectedDurationMin timeline patientId')
      .sort({ scheduledAt: 1 })
      .limit(10)
      .lean<any[]>(),
    HomecareRequest.countDocuments({ deletedAt: null, status: 'ASSIGNED', ...(desk ? {} : { 'assignment.primaryStaffId': user.id }) }),
    Note.countDocuments({ authorId: user.id, deletedAt: null }),
    Notification.countDocuments({ userId: user.id, readAt: null }),
  ])
  await withPeople(today)
  // Hero: the visit in progress, else the next one that is not yet started
  const hero = plain(next.find((r) => r.status === 'IN_PROGRESS') ?? next.find((r) => r.status === 'EN_ROUTE') ?? next.find((r) => new Date(r.scheduledAt).getTime() > Date.now() - 60 * 60_000) ?? null)
  const rows = plain(today)
  const completed = rows.filter((r: any) => ['COMPLETED', 'CLOSED'].includes(r.status)).length
  const isMine = (r: any) => [r.assignment?.primaryStaffId, ...(r.assignment?.secondaryStaffIds ?? [])].map(String).includes(user.id)

  const quick = [
    { href: '/m/new-request', label: 'New request', icon: Plus, cls: 'bg-primary-50 text-primary' },
    { href: '/m/notes', label: 'Add note', icon: Pencil, cls: 'bg-primary-50 text-primary-700' },
    { href: '/m/route', label: 'Day route', icon: Navigation, cls: 'bg-[#DCFCE7] text-[#15803D]' },
    { href: '/m/help', label: 'How to use', icon: FileText, cls: 'bg-[#EDE9FE] text-[#6D28D9]' },
  ].filter((q) => q.href !== '/m/new-request' || can(user, 'requests.create'))

  const kpis = [
    { n: rows.length, label: 'Today', color: '#0F172A', href: '/m/visits' },
    { n: awaiting, label: 'Awaiting accept', color: '#7C3AED', href: '/m/visits?seg=upcoming&status=ASSIGNED', ring: awaiting > 0 },
    { n: completed, label: 'Completed', color: '#16A34A', href: '/m/visits?seg=completed' },
    { n: notes, label: 'My notes', color: '#0072A3', href: '/m/notes' },
  ]

  return (
    <MScreen
      tab="home"
      header={
        <div className="sticky top-0 z-20">
          <SyncBanner />
          <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-5 pb-3.5 pt-[max(14px,env(safe-area-inset-top))]">
            <Link href="/m/profile">
              <Avatar name={user.name} initials={user.initials} size={44} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] text-slate-500">Signed in as</div>
              <div className="truncate text-[17px] font-bold leading-[22px]">{user.name}</div>
              <div className="truncate text-[12px] text-slate-500">
                {user.designation ?? user.role} · {user.employeeId}
              </div>
            </div>
            <Link href="/m/notifications" className="relative flex size-10 flex-none items-center justify-center rounded-[10px] border border-slate-200 text-slate-700" aria-label="Notifications">
              <Bell size={20} />
              <UnreadBadge initial={unread} className="absolute -right-1 -top-1" />
            </Link>
          </div>
        </div>
      }
    >
      <Col>
      <AutoRefresh seconds={30} />
      <div className={cx('grid gap-2', quick.length === 4 ? 'grid-cols-4' : 'grid-cols-3')}>
        {quick.map((q) => (
          <Link key={q.href} href={q.href} className="flex flex-col items-center gap-2 rounded-card bg-white px-1.5 py-3 shadow-card active:bg-slate-50">
            <span className={cx('flex size-10 items-center justify-center rounded-[10px]', q.cls)}>
              <q.icon size={20} />
            </span>
            <span className="whitespace-nowrap text-center text-[11.5px] font-semibold leading-[14px] text-slate-700">{q.label}</span>
          </Link>
        ))}
      </div>

      <AvailabilitySeg value={user.availability} />

      <div className="flex gap-2">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={cx('flex-auto rounded-card bg-white p-2.5 shadow-card', k.ring && 'outline outline-[1.5px] outline-[#7C3AED]')}>
            <div className="text-[20px] font-bold leading-6" style={{ color: k.color }}>
              {k.n}
            </div>
            <div className="whitespace-nowrap text-[11px] text-slate-500">{k.label}</div>
          </Link>
        ))}
      </div>

      {hero && (
        <>
          <SectionLabel>{hero.status === 'IN_PROGRESS' ? 'Now' : 'Next visit'}</SectionLabel>
          <div className="rounded-2xl bg-primary p-4 text-white shadow-[0_8px_20px_rgba(0,144,202,.28)]">
            <Link href={vHref(hero._id)} className="block">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[30px] font-bold leading-[34px]">{time(hero.scheduledAt)}</div>
                  <div className="mt-0.5 text-[13px] opacity-90">
                    {hero.status === 'IN_PROGRESS' ? <InMin to={hero.timeline?.checkInAt ?? hero.scheduledAt} started /> : <InMin to={hero.scheduledAt} />} · {svcName(hero)}
                  </div>
                </div>
                <span className="inline-flex h-6 flex-none items-center gap-1.5 whitespace-nowrap rounded-full bg-white/20 px-2.5 text-[12px] font-semibold uppercase">
                  <span className={cx('size-[7px] rounded-full bg-white', hero.status === 'IN_PROGRESS' && 'animate-hcpulse')} />
                  {hero.status.replace('_', ' ')}
                </span>
              </div>
              <div className="mt-3 text-[17px] font-semibold">
                {hero.patientSnapshot?.name}{' '}
                <span className="text-[14px] font-normal opacity-85">
                  · {ageG(hero.patientSnapshot)}
                  {hero.patientSnapshot?.area ? ` · ${hero.patientSnapshot.area}` : ''}
                </span>
              </div>
            </Link>
            <div className="mt-3.5 flex gap-2">
              <a href={telUrl(hero.patientSnapshot?.phone)} className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white/15 text-[14px] font-semibold">
                <Phone size={18} /> Call
              </a>
              <a
                href={`https://wa.me/${(hero.patientSnapshot?.phone ?? '').replace(/\D/g, '').replace(/^0/, '880')}`}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white/15 text-[14px] font-semibold"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
                </svg>
                WhatsApp
              </a>
              <a href={mapsUrl(hero.patientSnapshot?.address)} target="_blank" rel="noreferrer" className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-white text-[14px] font-semibold text-primary-700">
                <MapPin size={18} /> Map
              </a>
            </div>
          </div>
        </>
      )}

      <SectionLabel>
        {desk ? 'All visits today' : 'Today'} · {rows.length} visit{rows.length === 1 ? '' : 's'}
      </SectionLabel>
      {rows.length ? (
        rows.map((r: any) => {
          const mineAssigned = r.status === 'ASSIGNED' && isMine(r)
          return (
            <VisitCard
              key={r._id}
              r={r}
              href={vHref(r._id)}
              highlight={hero?._id === r._id}
              muted={['COMPLETED', 'CLOSED'].includes(r.status)}
              footer={mineAssigned ? <RespondInline r={r} primary={String(r.assignment?.primaryStaffId) === user.id} /> : desk && r.primaryStaff ? <div className="text-[12px] text-slate-500">{r.primaryStaff.name}</div> : undefined}
            />
          )
        })
      ) : (
        <div className="rounded-card bg-white shadow-card">
          <Empty icon={<CalendarX2 size={26} />} title="No visits today" sub={user.availability === 'ON_DUTY' ? 'New assignments appear here and as a notification.' : 'You are marked off duty — switch to On duty to get assignments.'} />
        </div>
      )}
      <div className="h-14" />
      {can(user, 'requests.create') && (
        <div className="pointer-events-none sticky bottom-[84px] z-10 -mt-[68px] flex justify-end">
          <Link href="/m/new-request" className="pointer-events-auto flex h-[52px] items-center gap-2 rounded-full bg-primary pl-3.5 pr-[18px] text-[15px] font-bold text-white shadow-[0_8px_20px_rgba(0,144,202,.35)]">
            <Plus size={22} /> New request
          </Link>
        </div>
      )}
      </Col>
    </MScreen>
  )
}
