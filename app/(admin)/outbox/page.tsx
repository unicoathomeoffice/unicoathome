import type { Metadata } from 'next'
import Link from 'next/link'
import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { listPending } from '@/lib/wa/outbox'
import { linkState } from '@/lib/wa/status'
import { AdminPage } from '@/components/admin/AdminPage'
import { OutboxPanel } from '@/components/comms/OutboxPanel'

export const metadata: Metadata = { title: 'WhatsApp outbox' }

/** Every WhatsApp waiting for an admin: preview, edit, send or discard. */
export default async function OutboxPage() {
  await requireWebUser('messages.approve')
  const [items, link, s] = await Promise.all([listPending(), linkState(), getSettings()])
  return (
    <AdminPage title="WhatsApp outbox" crumbs="Messages waiting for your approval">
      <div className="mx-auto flex max-w-[860px] flex-col gap-4">
        {s.whatsapp.approval === 'OFF' && (
          <div className="rounded-lg bg-slate-100 px-3.5 py-2.5 text-[13px] text-slate-600">
            Approval is off — new WhatsApp messages go out on their own.{' '}
            <Link href="/settings#whatsapp" className="font-semibold text-primary-700 hover:underline">
              Turn “Send only after approval” on
            </Link>
          </div>
        )}
        <OutboxPanel initial={JSON.parse(JSON.stringify(items))} linked={link.state === 'connected'} />
      </div>
    </AdminPage>
  )
}
