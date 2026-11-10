import { MScreen } from '@/components/mobile'
import { requireDesk } from '@/components/coord/data'
import { listPending } from '@/lib/wa/outbox'
import { linkState } from '@/lib/wa/status'
import { OutboxPanel } from '@/components/comms/OutboxPanel'

export const metadata = { title: 'WhatsApp outbox' }

/** WhatsApp waiting for approval — the coordinator checks, edits and sends from the phone. */
export default async function MobileOutbox() {
  await requireDesk('messages.approve')
  const [items, link] = await Promise.all([listPending(), linkState()])
  return (
    <MScreen title="WhatsApp outbox" sub="Nothing is sent until you send it" back="/m/admin">
      <div className="px-4 py-4">
        <OutboxPanel initial={JSON.parse(JSON.stringify(items))} linked={link.state === 'connected'} requestHref={(id) => `/m/admin/requests/${id}`} />
      </div>
    </MScreen>
  )
}
