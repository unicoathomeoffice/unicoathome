import type { Metadata } from 'next'
import Link from 'next/link'
import { requireWebUser } from '@/lib/auth'
import { getSettings } from '@/lib/settings'
import { waNumber } from '@/lib/messaging'
import { listChats } from '@/lib/wa/history'
import { linkState } from '@/lib/wa/status'
import { AdminPage } from '@/components/admin/AdminPage'
import { WaInbox } from '@/components/comms/WaInbox'

export const metadata: Metadata = { title: 'WhatsApp' }

/** The WhatsApp inbox: every message the system wrote, one chat per number — approve, edit, send, read the history. */
export default async function OutboxPage({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  await requireWebUser('messages.approve')
  const sp = await searchParams
  const [chats, link, s] = await Promise.all([listChats(), linkState(), getSettings()])
  const to = sp.to ? waNumber(sp.to) : null
  return (
    <AdminPage title="WhatsApp" crumbs="Every message · waiting for approval, sent, read, failed" pad={false} className="flex flex-col">
      {s.whatsapp.approval === 'OFF' && (
        <div className="flex-none bg-[#FFF8E1] px-4 py-2 text-[13px] text-[#92400E]">
          Approval is off — new WhatsApp messages go out on their own.{' '}
          <Link href="/settings#whatsapp" className="font-semibold underline">
            Turn “Send only after approval” on
          </Link>
        </div>
      )}
      <WaInbox initialChats={JSON.parse(JSON.stringify(chats))} initialTo={to && to.length >= 8 ? to : null} linked={link.state === 'connected'} className="min-h-0 flex-1" />
    </AdminPage>
  )
}
