import Link from 'next/link'
import { ChevronRight, HelpCircle, LayoutDashboard, MapPin } from 'lucide-react'
import { MScreen } from '@/components/mobile'
import { Col } from '@/components/field/bar'
import { FHeader } from '@/components/field'
import { AvailabilitySeg } from '@/components/field/home'
import { PrefsRow, DevicesRow, PasswordRow, SignOutButton } from '@/components/field/profile'
import { teamFilter } from '@/components/field/data'
import { requireAppUser } from '@/lib/auth'
import { db, plain } from '@/lib/db'
import { Department, HomecareRequest, Session, User } from '@/lib/models'
import { getSettings } from '@/lib/settings'
import { ROLE_LABEL } from '@/lib/constants'
import { dayRange, isoDay, phone } from '@/lib/format'

export const metadata = { title: 'Profile' }

const SKILL_LABEL = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()).replace(/\bIv\b/i, 'IV').replace(/\becg\b/i, 'ECG')

/** M15 Profile & settings */
export default async function Profile() {
  const user = await requireAppUser()
  await db()
  const u = await User.findById(user.id).lean<any>()
  const monthStart = dayRange(`${isoDay().slice(0, 7)}-01`).start
  const field = ['DOCTOR', 'NURSE', 'ALLIED'].includes(user.role)
  const [dept, sessions, month, rated, settings] = await Promise.all([
    u?.departmentId ? Department.findById(u.departmentId).select('name').lean<any>() : null,
    Session.find({ userId: user.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).lean<any[]>(),
    field ? HomecareRequest.find({ ...teamFilter(user), status: { $in: ['COMPLETED', 'CLOSED'] }, 'timeline.checkInAt': { $gte: monthStart } }).select('visit.lateMin').lean<any[]>() : [],
    field ? HomecareRequest.find({ ...teamFilter(user), 'feedback.rating': { $gt: 0 }, 'timeline.checkInAt': { $gte: new Date(Date.now() - 90 * 86400_000) } }).select('feedback.rating').lean<any[]>() : [],
    getSettings(),
  ])
  const onTime = month.length ? Math.round((month.filter((r) => (r.visit?.lateMin ?? 0) <= settings.sla.lateAfterMin).length / month.length) * 100) : null
  const rating = rated.length ? rated.reduce((a, r) => a + r.feedback.rating, 0) / rated.length : null
  const monthName = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', month: 'short' }).format(new Date())
  const stats = [
    { n: field ? month.length : '—', label: `Visits · ${monthName}` },
    { n: onTime != null ? `${onTime}%` : '—', label: 'On time' },
    { n: rating != null ? rating.toFixed(1) : '—', label: 'Rating' },
  ]
  const sess = plain(sessions).map((s: any) => ({ _id: s._id, client: s.client, userAgent: s.userAgent, ip: s.ip, lastSeenAt: s.lastSeenAt, createdAt: s.createdAt, current: s.jti === user.jti }))

  return (
    <MScreen tab="profile" header={<FHeader title="Profile" />}>
      <Col>
      <div className="flex items-center gap-4 py-1">
        {u?.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={u.photoUrl} alt={user.name} className="size-16 flex-none rounded-full object-cover" />
        ) : (
          <div className="flex size-16 flex-none items-center justify-center rounded-full bg-primary-50 text-[22px] font-bold text-primary-700">{user.initials}</div>
        )}
        <div className="min-w-0">
          <div className="text-[20px] font-bold leading-6">{user.name}</div>
          <div className="text-[14px] text-slate-500">
            {user.designation ?? ROLE_LABEL[user.role]}
            {dept?.name ? ` · ${dept.name}` : ''}
          </div>
          <div className="text-[13px] text-slate-400">
            {user.employeeId} · {phone(user.phone)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-card bg-white px-2 py-3 text-center shadow-card">
            <div className="text-[22px] font-bold leading-7">{s.n}</div>
            <div className="text-[12px] text-slate-500">{s.label}</div>
          </div>
        ))}
      </div>

      {user.role !== 'DRIVER' && (
        <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
          <div className="mb-2.5 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Availability</div>
          <AvailabilitySeg value={user.availability} h={40} />
        </div>
      )}

      {(user.skills.length > 0 || user.zones.length > 0) && (
        <div className="rounded-card bg-white px-4 py-3.5 shadow-card">
          <div className="mb-2.5 text-[13px] font-semibold uppercase tracking-[.06em] text-slate-500">Skills &amp; zones</div>
          <div className="flex flex-wrap gap-1.5">
            {user.skills.map((s) => (
              <span key={s} className="inline-flex h-7 items-center rounded-full bg-primary-50 px-2.5 text-[12px] font-semibold text-primary-700">
                {SKILL_LABEL(s)}
              </span>
            ))}
            {user.zones.map((z) => (
              <span key={z} className="inline-flex h-7 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-[12px] font-semibold text-slate-700">
                <MapPin size={12} /> {z}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="divide-y divide-slate-100 overflow-hidden rounded-card bg-white shadow-card">
        <PrefsRow initial={{ push: true, email: u?.notificationPrefs?.email !== false, whatsapp: u?.notificationPrefs?.whatsapp !== false, quietHours: u?.notificationPrefs?.quietHours }} />
        <DevicesRow sessions={sess} />
        <PasswordRow />
        <Link href="/m/help" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-slate-50">
          <HelpCircle size={20} className="flex-none text-slate-600" />
          <span className="flex-1 text-[15px] font-medium">Help &amp; how to use</span>
          <ChevronRight size={18} className="text-slate-400" />
        </Link>
        {user.platformAccess.includes('web') && (
          <a href="/dashboard" className="flex min-h-14 items-center gap-3 px-4 py-3 active:bg-slate-50">
            <LayoutDashboard size={20} className="flex-none text-slate-600" />
            <span className="flex-1 text-[15px] font-medium">Open web admin</span>
            <ChevronRight size={18} className="text-slate-400" />
          </a>
        )}
      </div>

      <SignOutButton />
      <div className="pb-2 text-center text-[12px] text-slate-400">
        Unico HomeCare · {ROLE_LABEL[user.role]} · {settings.general.hospitalName}
      </div>
      </Col>
    </MScreen>
  )
}
