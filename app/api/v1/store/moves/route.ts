import { route } from '@/lib/api'
import { listMoves } from '@/lib/services/stock'

/** GET ?itemId=&reason=&from=YYYY-MM-DD&to=YYYY-MM-DD — the store ledger (newest first, max 500). */
export const GET = route(
  async ({ req }) => {
    const q = req.nextUrl.searchParams
    return { items: await listMoves({ itemId: q.get('itemId') ?? undefined, reason: q.get('reason') ?? undefined, from: q.get('from') ?? undefined, to: q.get('to') ?? undefined }) }
  },
  { perm: 'store.manage' },
)
