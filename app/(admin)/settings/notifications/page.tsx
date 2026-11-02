import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { emailConfigured } from '@/lib/messaging'
import { AdminPage } from '@/components/admin/AdminPage'
import { NotificationRules } from '@/components/settings/NotificationRules'
import { canOpenSettings } from '@/lib/constants'
import { ExtraRecipients } from '@/components/settings/ExtraRecipients'
import { HodContacts } from '@/components/settings/HodContacts'
import { hodConfig } from '@/lib/services/hod'
import { VisitUpdateSettings } from '@/components/settings/VisitUpdateSettings'
import { DailySummarySettings } from '@/components/settings/DailySummarySettings'
import { activeServices } from '@/lib/cached'
import { isPaired, pairedPhone } from '@/lib/wa/status'

export const metadata: Metadata = { title: 'Notification rules' }

export default async function NotificationRulesPage() {
  const user = await requireWebUser()
  if (!canOpenSettings(user)) redirect('/dashboard?denied=1')
  const [s, services, paired, phone] = await Promise.all([getSettings(), activeServices(), isPaired(), pairedPhone()])
  return (
    <AdminPage title="Notification rules" crumbs="Settings">
      <NotificationRules
        initial={JSON.parse(JSON.stringify(s.notificationRules))}
        quiet={JSON.parse(JSON.stringify(s.quietHours))}
        integrations={{ gmail: (await emailConfigured()), cron: !!process.env.CRON_SECRET }}
        myEmail={user.email}
      />
      <div className="mt-5 max-w-[1200px]">
        <HodContacts initial={JSON.parse(JSON.stringify(hodConfig(s.hodAlerts as any)))} services={services.map((t) => ({ code: t.code, name: t.name, category: t.category ?? '' }))} wa={{ paired, phone }} />
      </div>
      <div className="mt-5 max-w-[900px]">
        <VisitUpdateSettings initial={JSON.parse(JSON.stringify(s.visitUpdates))} />
      </div>
      <div className="mt-5 max-w-[900px]">
        <DailySummarySettings initial={JSON.parse(JSON.stringify(s.dailyWhatsApp))} />
      </div>
      <div className="mt-5 max-w-[900px]">
        <ExtraRecipients initial={JSON.parse(JSON.stringify(s.emailCopies ?? {}))} />
      </div>
    </AdminPage>
  )
}
