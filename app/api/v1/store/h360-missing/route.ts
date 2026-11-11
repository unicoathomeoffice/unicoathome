import { route } from '@/lib/api'
import { H360Error } from '@/lib/h360'
import { Equipment } from '@/lib/models'
import { fetchSubStoreStock } from '@/lib/h360-store'

export const maxDuration = 30

/** GET — items in H360's Family Medicine sub-store that are not in the HomeCare store yet. */
export const GET = route(
  async () => {
    try {
      const h = await fetchSubStoreStock({ fresh: true })
      const local = await Equipment.find({}).select('h360Code name').lean<any[]>()
      const codes = new Set(local.map((l) => l.h360Code).filter(Boolean))
      const names = new Set(local.map((l) => String(l.name).toLowerCase().replace(/[^a-z0-9]+/g, '')))
      return { store: h.storeName, items: h.items.filter((r) => !codes.has(r.code) && !names.has(r.name.toLowerCase().replace(/[^a-z0-9]+/g, ''))) }
    } catch (e) {
      if (e instanceof H360Error) return { items: [], error: e.message }
      throw e
    }
  },
  { perm: 'store.manage' },
)
