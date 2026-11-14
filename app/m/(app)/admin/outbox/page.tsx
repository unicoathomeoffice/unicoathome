import { MScreen } from '@/components/mobile'
import { requireDesk } from '@/components/coord/data'
import { waNumber } from '@/lib/messaging'
import { listChats } from '@/lib/wa/history'
import { linkState } from '@/lib/wa/status'
import { WaInbox } from '@/components/comms/WaInbox'

export const metadata = { title: 'WhatsApp' }

/** WhatsApp on the phone: chats → conversation, approve / edit / send, and the full history. */
export default async function MobileOutbox({ searchParams }: { searchParams: Promise<{ to?: string }> }) {
  await requireDesk('messages.approve')
  const sp = await searchParams
  const [chats, link] = await Promise.all([listChats(), linkState()])
  const to = sp.to ? waNumber(sp.to) : null
  return (
    <MScreen title="WhatsApp" sub="Nothing is sent until you send it" back="/m/admin" pad={false} bg="bg-white">
      <WaInbox
        initialChats={JSON.parse(JSON.stringify(chats))}
        initialTo={to && to.length >= 8 ? to : null}
        linked={link.state === 'connected'}
        requestBase="/m/admin/requests/"
        profileLinks={false}
        className="h-[calc(100dvh-64px)]"
      />
    </MScreen>
  )
}
