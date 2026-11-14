import { route } from '@/lib/api'
import { background } from '@/lib/messaging'
import { listChats, receiptsDue, type ChatFilter } from '@/lib/wa/history'
import { receiptsAt, syncInbox } from '@/lib/wa/service'

export const maxDuration = 60 // the background tick update below may take ~20 s

const FILTERS: ChatFilter[] = ['all', 'waiting', 'sent', 'failed', 'discarded', 'unread', 'groups']
const STALE_MS = 10 * 60_000

/**
 * GET ?q=&filter= — one chat per WhatsApp number (waiting ones first), for the WhatsApp inbox.
 * When the delivered / read ticks are more than 10 minutes old, they are collected in the background.
 */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    const f = q.get('filter') as ChatFilter
    const [chats, at] = await Promise.all([listChats({ q: q.get('q') ?? '', filter: FILTERS.includes(f) ? f : 'all' }), receiptsAt()])
    if ((!at || Date.now() - new Date(at).getTime() > STALE_MS) && (await receiptsDue())) background(() => syncInbox())
    return { chats, receiptsAt: at ? new Date(at).toISOString() : null }
  },
  { perm: 'messages.approve' },
)
