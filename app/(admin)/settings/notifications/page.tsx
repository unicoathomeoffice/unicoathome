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
import { VisitUpdateSettings } from '@/components/settings/VisitUpdateSettings'
import { activeServices } from '@/lib/cached'
import { isPaired, pairedPhone } from '@/lib/wa/status'

export const metadata: Metadata = { title: 'Notification rules' }

export default async function NotificationRulesPage() {
  const user = await requireWebUser()
  if (!canOpenSettings(user)) redirect('/dashboard?denied=1')
  const [s, services, paired, phone] = await Promise.all([getSettings(), activeServices(), isPaired(), pairedPhone()])
  const byCat: Record<string, string[]> = {}
  for (const t of services) (byCat[String(t.category ?? '').toLowerCase()] ??= []).push(t.name)
  return (
    <AdminPage title="Notification rules" crumbs="Settings">
      <NotificationRules
        initial={JSON.parse(JSON.stringify(s.notificationRules))}
        quiet={JSON.parse(JSON.stringify(s.quietHours))}
        integrations={{ gmail: (await emailConfigured()), cron: !!process.env.CRON_SECRET }}
        myEmail={user.email}
      />
      <div className="mt-5 max-w-[1200px]">
        <HodContacts initial={JSON.parse(JSON.stringify(s.hodAlerts))} services={byCat} wa={{ paired, phone }} />
      </div>
      <div className="mt-5 max-w-[900px]">
        <VisitUpdateSettings initial={JSON.parse(JSON.stringify(s.visitUpdates))} />
      </div>
      <div className="mt-5 max-w-[900px]">
        <ExtraRecipients initial={JSON.parse(JSON.stringify(s.emailCopies ?? {}))} />
      </div>
    </AdminPage>
  )
}
