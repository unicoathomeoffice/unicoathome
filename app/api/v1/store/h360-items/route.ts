import { route } from '@/lib/api'
import { H360Error } from '@/lib/h360'
import { Equipment } from '@/lib/models'
import { searchInventoryItems } from '@/lib/h360-store'

export const maxDuration = 30

/** GET ?q= — H360's inventory item list (read-only), flagged when the item is already in our store. */
export const GET = route(
  async ({ req }) => {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
    if (q.length < 2) return { items: [] }
    try {
      const items = await searchInventoryItems(q)
      const have = new Set((await Equipment.find({ h360Code: { $in: items.map((i) => i.code).filter(Boolean) } }).select('h360Code').lean<any[]>()).map((e) => e.h360Code))
      return { items: items.map((i) => ({ ...i, inStore: have.has(i.code) })) }
    } catch (e) {
      if (e instanceof H360Error) return { items: [], error: e.message }
      throw e
    }
  },
  { perm: 'store.manage' },
)
