import { AdminPage } from '@/components/admin/AdminPage'
import { Avatar, Card, CardHeader, KV, Tag } from '@/components/ui'
import { requireWebUser } from '@/lib/auth'
import { db } from '@/lib/db'
import { Department, Designation, Session, User } from '@/lib/models'
import { AVAILABILITY_LABEL, ROLE_LABEL } from '@/lib/constants'
import { ago, dateTime, phone } from '@/lib/format'
import { PasswordForm, Prefs, Sessions, type SessionRow } from './AccountForms'

export const metadata = { title: 'My account' }

function deviceLabel(ua?: string) {
  if (!ua) return 'Unknown device'
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /okhttp|Expo|Dart/i.test(ua) ? 'App' : /^node|undici|curl|axios/i.test(ua) ? 'Script / API client' : 'Browser'
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : ''
  return [browser, os].filter(Boolean).join(' on ')
}

export default async function AccountPage() {
  const me = await requireWebUser()
  await db()
  const [u, sessions] = await Promise.all([
    User.findById(me.id).lean<any>(),
    Session.find({ userId: me.id, revokedAt: null, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }).limit(50).lean<any[]>(),
  ])
  const [desig, dept] = await Promise.all([
    u?.designationId ? Designation.findById(u.designationId).select('title').lean<any>() : null,
    u?.departmentId ? Department.findById(u.departmentId).select('name').lean<any>() : null,
  ])
  const rows: SessionRow[] = sessions
    .map((s) => ({
      id: String(s._id),
      client: s.client ?? 'web',
      device: deviceLabel(s.userAgent),
      ip: s.ip ?? '',
      lastSeen: ago(s.lastSeenAt ?? s.createdAt),
      created: dateTime(s.createdAt),
      current: s.jti === me.jti,
    }))
    .sort((a, b) => Number(b.current) - Number(a.current))
  const prefs = {
    push: u?.notificationPrefs?.push ?? true,
    email: u?.notificationPrefs?.email ?? true,
    whatsapp: u?.notificationPrefs?.whatsapp ?? true,
    quietHours: { from: u?.notificationPrefs?.quietHours?.from ?? '22:00', to: u?.notificationPrefs?.quietHours?.to ?? '07:00' },
  }
  return (
    <AdminPage title="My account">
      <div className="grid max-w-[1200px] gap-5 xl:grid-cols-[1fr_1.15fr]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <div className="flex items-center gap-4">
              <Avatar initials={me.initials} size={64} tone="teal" />
              <div className="min-w-0">
                <div className="truncate text-[20px] font-bold">{u?.name ?? me.name}</div>
                <div className="text-[13px] text-slate-500">
                  {desig?.title ?? ROLE_LABEL[me.role]} · {u?.employeeId}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <Tag tone="blue">{ROLE_LABEL[me.role]}</Tag>
                  {(u?.platformAccess ?? []).map((p: string) => (
                    <Tag key={p} tone="slate">
                      {p === 'web' ? 'Web admin' : 'Field app'}
                    </Tag>
                  ))}
                  {u?.availability && <Tag tone={u.availability === 'ON_DUTY' ? 'green' : 'amber'}>{AVAILABILITY_LABEL[u.availability as 'ON_DUTY']}</Tag>}
                </div>
              </div>
            </div>
            <div className="mt-4 border-t border-slate-100 pt-2">
              <KV k="Employee ID" v={u?.employeeId} />
              <KV k="Phone" v={phone(u?.phone)} />
              <KV k="WhatsApp" v={u?.whatsapp ? phone(u.whatsapp) : 'Same as phone'} />
              <KV k="Email" v={u?.email ?? '—'} />
              <KV k="Department" v={dept?.name ?? '—'} />
              <KV k="Designation" v={desig?.title ?? '—'} />
              {(u?.zones ?? []).length > 0 && <KV k="Zones" v={u.zones.join(', ')} />}
              <KV k="Last sign-in" v={u?.lastLoginAt ? dateTime(u.lastLoginAt) : '—'} />
              <KV k="Account created" v={u?.createdAt ? dateTime(u.createdAt) : '—'} />
            </div>
            <div className="mt-2 text-[12px] text-slate-500">To change your name, phone or role, ask a super admin.</div>
          </Card>
          <Card>
            <CardHeader title="Change password" sub={u?.mustChangePassword ? 'You are using a temporary password — please change it now.' : 'Other devices stay signed in unless you sign them out.'} />
            <PasswordForm />
          </Card>
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title={`Active sessions · ${rows.length}`} sub="Devices currently signed in to your account" />
            <Sessions rows={rows} />
          </Card>
          <Card>
            <CardHeader title="Notification preferences" sub="How we reach you outside the app" />
            <Prefs initial={prefs} />
          </Card>
        </div>
      </div>
    </AdminPage>
  )
}
