import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { emailConfigured } from '@/lib/messaging'
import { AdminPage } from '@/components/admin/AdminPage'
import { NotificationRules } from '@/components/settings/NotificationRules'
import { canOpenSettings } from '@/lib/constants'
import { ExtraRecipients } from '@/components/settings/ExtraRecipients'

export const metadata: Metadata = { title: 'Notification rules' }

export default async function NotificationRulesPage() {
  const user = await requireWebUser()
  if (!canOpenSettings(user)) redirect('/dashboard?denied=1')
  const s = await getSettings()
  return (
    <AdminPage title="Notification rules" crumbs="Settings">
      <NotificationRules
        initial={JSON.parse(JSON.stringify(s.notificationRules))}
        quiet={JSON.parse(JSON.stringify(s.quietHours))}
        integrations={{ gmail: (await emailConfigured()), cron: !!process.env.CRON_SECRET }}
        myEmail={user.email}
      />
      <div className="mt-5 max-w-[900px]">
        <ExtraRecipients initial={JSON.parse(JSON.stringify(s.emailCopies ?? {}))} />
      </div>
    </AdminPage>
  )
}
