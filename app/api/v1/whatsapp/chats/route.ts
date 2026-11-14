import { route } from '@/lib/api'
import { listChats, type ChatFilter } from '@/lib/wa/history'

const FILTERS: ChatFilter[] = ['all', 'waiting', 'sent', 'failed', 'discarded']

/** GET ?q=&filter= — one chat per WhatsApp number (waiting ones first), for the WhatsApp inbox. */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    const f = q.get('filter') as ChatFilter
    return { chats: await listChats({ q: q.get('q') ?? '', filter: FILTERS.includes(f) ? f : 'all' }) }
  },
  { perm: 'messages.approve' },
)
