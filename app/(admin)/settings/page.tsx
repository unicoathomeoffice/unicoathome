import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, BellRing, CheckCircle2, Circle, FileText, SlidersHorizontal } from 'lucide-react'
import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { emailConfigured } from '@/lib/messaging'
import { MessageLog, Notification } from '@/lib/models'
import { DEFAULT_TEMPLATES } from '@/lib/templates'
import { AdminPage } from '@/components/admin/AdminPage'
import { FeaturesCard, GeneralCard, GmailCard, JobsCard, SCard, WhatsAppCard } from '@/components/settings/SettingsCards'
import { when } from '@/components/comms/MessageBits'
import { cx } from '@/lib/format'
import vercel from '@/vercel.json'

export const metadata: Metadata = { title: 'Settings & integrations' }

const plain = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

/** Env vars the deployment needs (values are never shown — only whether they are set). */
const ENV: { key: string; need: 'required' | 'email' | 'recommended' | 'optional'; what: string }[] = [
  { key: 'MONGODB_URI', need: 'required', what: 'MongoDB Atlas connection string' },
  { key: 'JWT_SECRET', need: 'required', what: 'Signs session tokens (32+ random characters)' },
  { key: 'APP_BASE_URL', need: 'recommended', what: 'Public URL used in email links and the patient feedback link' },
  { key: 'GMAIL_USER', need: 'email', what: 'Sending Gmail / Workspace address (e.g. homecare@unicohospitals.com)' },
  { key: 'GMAIL_APP_PASSWORD', need: 'email', what: '16-character App Password (Google account → Security → 2-Step Verification → App passwords)' },
  { key: 'EMAIL_FROM_NAME', need: 'optional', what: 'Display name on outgoing email' },
  { key: 'DEPARTMENT_EMAIL', need: 'optional', what: 'Default department CC for visit reports' },
  { key: 'CRON_SECRET', need: 'recommended', what: 'Lets Vercel Cron run the sweep / digest jobs' },
  { key: 'WA_DEFAULT_COUNTRY', need: 'optional', what: 'Country code for WhatsApp numbers (default 880)' },
  { key: 'HOSPITAL_PHONE', need: 'optional', what: 'Hotline shown in messages (can also be set here)' },
]

/** "0 14 * * *" (UTC) → "daily 20:00" (Dhaka) */
function cronText(expr: string) {
  const [m, h] = expr.split(' ')
  if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) return expr
  const mins = (Number(h) * 60 + Number(m) + 6 * 60) % (24 * 60)
  return `daily ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
}

export default async function SettingsPage() {
  const user = await requireWebUser()
  if (!['SUPER_ADMIN', 'HC_ADMIN'].includes(user.role)) redirect('/dashboard?denied=1')
  const [s, lastEmail, inapp7d, unreadAll] = await Promise.all([
    getSettings(),
    MessageLog.findOne({ channel: 'EMAIL' }).sort({ at: -1 }).select('at templateKey status subject').lean<any>(),
    Notification.countDocuments({ createdAt: { $gte: new Date(Date.now() - 7 * 86400_000) } }),
    Notification.countDocuments({ readAt: null }),
  ])
  const gmail = { configured: emailConfigured(), user: process.env.GMAIL_USER ? process.env.GMAIL_USER.replace(/^(.{3}).*(@.*)$/, '$1•••$2') : null }
  const sla = s.sla
  const schedules = ((vercel as any).crons ?? []).map((c: any) => ({ path: c.path, when: cronText(c.schedule) }))

  return (
    <AdminPage title="Settings & integrations" crumbs="Settings">
      <div className="grid items-stretch gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <GeneralCard initial={plain(s.general)} />

        <SCard title="SLA thresholds" sub="Drive SLA pill colours and escalations" right={<Link href="/settings/zones" className="text-[13px] font-semibold text-primary-700 hover:underline">Edit</Link>}>
          {[
            ['Confirm · Routine', `${sla.confirmRoutineMin} min`],
            ['Confirm · Urgent', `${sla.confirmUrgentMin} min`],
            ['Assign after confirm', `${sla.assignMin} min`],
            ['Staff acceptance window', `${sla.acceptTimeoutMin} min`],
            ['Late check-in flag', `+${sla.lateAfterMin} min`],
            ['Overtime prompt', `+${sla.overtimePct}% of planned`],
            ['Overdue escalation', '15 min after slot'],
            ['Reminders', (sla.reminderBeforeMin ?? []).map((m: number) => (m >= 60 ? `T-${m / 60} h` : `T-${m} min`)).join(' · ')],
          ].map(([k, v]) => (
            <div key={k} className="flex items-center justify-between border-b border-slate-100 py-2.5 text-[13.5px] last:border-0">
              <span className="text-slate-700">{k}</span>
              <span className="rounded-lg border border-slate-200 px-3 py-1 font-semibold">{v}</span>
            </div>
          ))}
          <Link href="/settings/zones" className="mt-auto inline-flex items-center gap-1.5 pt-4 text-[13px] font-semibold text-primary-700 hover:underline">
            Zones, slots & rules <ArrowRight size={14} />
          </Link>
        </SCard>

        <GmailCard
          initial={plain(s.email)}
          gmail={gmail}
          lastSend={lastEmail ? { id: String(lastEmail._id), at: new Date(lastEmail.at).toISOString(), status: lastEmail.status, label: `${when(lastEmail.at)} · ${lastEmail.templateKey ?? 'email'}` } : null}
          myEmail={user.email}
        />

        <WhatsAppCard initial={plain(s.whatsapp)} envCountry={process.env.WA_DEFAULT_COUNTRY ?? '880'} />

        <SCard title="Push · in-app" sub="Notification centre now · Expo push (FCM / APNs) next">
          {[
            ['In-app notification centre', <span key="a" className="font-semibold text-[#15803D]">Active</span>],
            ['Bell badge refresh', 'every 30 s'],
            ['In-app alerts · last 7 days', inapp7d],
            ['Unread across all users', unreadAll],
            ['Expo project', <span key="e" className="text-slate-400">not connected</span>],
            ['FCM (Android) · APNs (iOS)', <span key="f" className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-600">Phase 2</span>],
          ].map(([k, v], i) => (
            <div key={i} className="flex items-center justify-between py-1.5 text-[13.5px]">
              <span className="text-slate-500">{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
          ))}
          <div className="mt-2 text-[12px] leading-[18px] text-slate-500">
            “Push” rows in the Messages log are in-app deliveries today. When Expo push is added, the same rules in <Link href="/settings/notifications" className="font-semibold text-primary-700">Notification rules</Link> apply.
          </div>
        </SCard>

        <FeaturesCard initial={plain(s.features) as Record<string, boolean>} />

        <JobsCard cron={!!process.env.CRON_SECRET} schedules={schedules} />

        <SCard title="Messages & rules" sub="Templates, notification matrix and logs">
          {[
            { href: '/settings/templates', icon: FileText, label: 'Message templates', sub: `${DEFAULT_TEMPLATES.length} templates · email, WhatsApp, push` },
            { href: '/settings/notifications', icon: SlidersHorizontal, label: 'Notification rules', sub: 'Event × recipient × channel, quiet hours' },
            { href: '/messages', icon: BellRing, label: 'Messages log', sub: 'Every email, WhatsApp and push with status' },
            { href: '/audit', icon: FileText, label: 'Audit log', sub: 'Append-only record of every change' },
          ].map((l) => (
            <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary-50 text-primary">
                <l.icon size={17} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold">{l.label}</div>
                <div className="truncate text-[12px] text-slate-500">{l.sub}</div>
              </div>
              <ArrowRight size={15} className="text-slate-400" />
            </Link>
          ))}
        </SCard>

        <SCard title="Setup checklist" sub="Secrets live only in Vercel → Project → Settings → Environment Variables (or .env.local). They are never stored in the database or shown here." className="lg:col-span-2 xl:col-span-1">
          <div className="flex flex-col">
            {ENV.map((e) => {
              const set = !!process.env[e.key]
              return (
                <div key={e.key} className="flex items-start gap-2.5 border-b border-slate-100 py-2 last:border-0">
                  {set ? <CheckCircle2 size={17} className="mt-px flex-none text-[#16A34A]" /> : <Circle size={17} className={cx('mt-px flex-none', e.need === 'required' ? 'text-[#DC2626]' : 'text-slate-300')} />}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="text-[12.5px] font-bold">{e.key}</code>
                      <span className={cx('rounded-full px-1.5 text-[10px] font-bold uppercase', e.need === 'required' ? 'bg-[#FEE2E2] text-[#B91C1C]' : e.need === 'email' ? 'bg-primary-50 text-primary-700' : e.need === 'recommended' ? 'bg-[#FEF3C7] text-[#B45309]' : 'bg-slate-100 text-slate-500')}>
                        {e.need === 'email' ? 'for email' : e.need}
                      </span>
                      <span className={cx('ml-auto text-[11.5px] font-semibold', set ? 'text-[#15803D]' : 'text-slate-400')}>{set ? 'set' : 'not set'}</span>
                    </div>
                    <div className="text-[12px] text-slate-500">{e.what}</div>
                  </div>
                </div>
              )
            })}
          </div>
          <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2.5 text-[12px] leading-[18px] text-slate-600">
            Gmail: turn on 2-Step Verification for the sending account, create an App Password, set <code>GMAIL_USER</code> + <code>GMAIL_APP_PASSWORD</code>, redeploy, then use <b>Send test</b> above. Until then emails are logged as <b>SKIPPED</b>.
          </div>
        </SCard>
      </div>
    </AdminPage>
  )
}
